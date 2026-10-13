import type { Pool, PoolClient } from "pg";
import { DrainParser, templateText, type Cluster } from "./drain.js";

export interface MiningEvent {
  ts: string;
  service: string;
  message: string;
}

interface ClusterStat {
  count: number;
  minTs: number;
  maxTs: number;
  /** Indexes (within the batch) of the first few events, used as stored examples. */
  exampleIdx: number[];
}

export interface PreparedBatch {
  /** Template id for each event, in batch order. */
  templateIds: string[];
  stats: Map<string, ClusterStat>;
  minuteCounts: { templateId: string; minuteMs: number; count: number }[];
}

export const MAX_EXAMPLES = 5;

interface ProjectState {
  parsers: Map<string, DrainParser>;
}

/**
 * Connects the pure Drain parser to Postgres. One parser per (project, service) lives in memory;
 * the first batch for a project after a restart rebuilds it from `log_templates`.
 *
 * Batches for the same project are prepared one at a time (a promise queue), so two concurrent
 * requests can never both create the same template. Everything after `prepare` runs concurrently.
 */
export class TemplateMiner {
  private readonly states = new Map<string, ProjectState>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly pool: Pool) {}

  /** Parses the batch, stores any new or generalised templates, and returns ids and statistics. */
  prepare(projectId: string, events: MiningEvent[]): Promise<PreparedBatch> {
    return this.exclusive(projectId, async () => {
      const state = await this.stateFor(projectId);

      const clusters: Cluster[] = [];
      const clusterStats = new Map<Cluster, ClusterStat>();
      events.forEach((event, index) => {
        let parser = state.parsers.get(event.service);
        if (!parser) {
          parser = new DrainParser();
          state.parsers.set(event.service, parser);
        }
        const { cluster } = parser.parse(event.message);
        clusters.push(cluster);

        const t = Date.parse(event.ts);
        const stat = clusterStats.get(cluster);
        if (!stat) {
          clusterStats.set(cluster, { count: 1, minTs: t, maxTs: t, exampleIdx: [index] });
        } else {
          stat.count++;
          stat.minTs = Math.min(stat.minTs, t);
          stat.maxTs = Math.max(stat.maxTs, t);
          if (stat.exampleIdx.length < MAX_EXAMPLES) stat.exampleIdx.push(index);
        }
      });

      await this.persistDirty(projectId, state, clusterStats);

      const stats = new Map<string, ClusterStat>();
      for (const [cluster, stat] of clusterStats) stats.set(cluster.externalId!, stat);

      const minuteMap = new Map<string, { templateId: string; minuteMs: number; count: number }>();
      events.forEach((event, index) => {
        const templateId = clusters[index].externalId!;
        const minuteMs = Math.floor(Date.parse(event.ts) / 60_000) * 60_000;
        const key = `${templateId}|${minuteMs}`;
        const entry = minuteMap.get(key);
        if (entry) entry.count++;
        else minuteMap.set(key, { templateId, minuteMs, count: 1 });
      });

      return {
        templateIds: clusters.map((cluster) => cluster.externalId!),
        stats,
        minuteCounts: [...minuteMap.values()],
      };
    });
  }

  /** Updates template statistics and per-minute counts. Call inside the transaction that inserted the events. */
  async finalize(client: PoolClient, prepared: PreparedBatch, eventIds: string[]): Promise<void> {
    const ids = [...prepared.stats.keys()].sort((a, b) => Number(BigInt(a) - BigInt(b)));

    // Lock in id order so concurrent batches cannot deadlock. NO KEY UPDATE (not FOR UPDATE):
    // the event INSERT already holds FOR KEY SHARE on these rows through the foreign key, and
    // two transactions each holding KEY SHARE and then asking for FOR UPDATE deadlock.
    await client.query(
      "SELECT id FROM log_templates WHERE id = ANY($1::bigint[]) ORDER BY id FOR NO KEY UPDATE",
      [ids],
    );

    await client.query(
      `UPDATE log_templates t SET
         total_count = t.total_count + u.cnt,
         first_seen = LEAST(t.first_seen, u.min_ts),
         last_seen = GREATEST(t.last_seen, u.max_ts),
         example_event_ids = CASE
           WHEN cardinality(t.example_event_ids) >= ${MAX_EXAMPLES} THEN t.example_event_ids
           ELSE (t.example_event_ids || string_to_array(u.examples, ',')::bigint[])[1:${MAX_EXAMPLES}]
         END
       FROM unnest($1::bigint[], $2::int[], $3::timestamptz[], $4::timestamptz[], $5::text[])
         AS u(id, cnt, min_ts, max_ts, examples)
       WHERE t.id = u.id`,
      [
        ids,
        ids.map((id) => prepared.stats.get(id)!.count),
        ids.map((id) => new Date(prepared.stats.get(id)!.minTs).toISOString()),
        ids.map((id) => new Date(prepared.stats.get(id)!.maxTs).toISOString()),
        ids.map((id) =>
          prepared.stats
            .get(id)!
            .exampleIdx.map((i) => eventIds[i])
            .join(","),
        ),
      ],
    );

    const counts = [...prepared.minuteCounts].sort(
      (a, b) => Number(BigInt(a.templateId) - BigInt(b.templateId)) || a.minuteMs - b.minuteMs,
    );
    await client.query(
      `INSERT INTO template_minute_counts (template_id, minute, count)
       SELECT * FROM unnest($1::bigint[], $2::timestamptz[], $3::int[])
       ON CONFLICT (template_id, minute) DO UPDATE
         SET count = template_minute_counts.count + EXCLUDED.count`,
      [
        counts.map((c) => c.templateId),
        counts.map((c) => new Date(c.minuteMs).toISOString()),
        counts.map((c) => c.count),
      ],
    );
  }

  private exclusive<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(projectId) ?? Promise.resolve();
    const run = previous.then(fn);
    const tail = run.catch(() => undefined);
    this.queues.set(projectId, tail);
    void tail.then(() => {
      if (this.queues.get(projectId) === tail) this.queues.delete(projectId);
    });
    return run;
  }

  private async stateFor(projectId: string): Promise<ProjectState> {
    const cached = this.states.get(projectId);
    if (cached) return cached;

    const result = await this.pool.query<{ id: string; service: string; template: string }>(
      "SELECT id::text AS id, service, template FROM log_templates WHERE project_id = $1 ORDER BY id",
      [projectId],
    );
    const state: ProjectState = { parsers: new Map() };
    for (const row of result.rows) {
      let parser = state.parsers.get(row.service);
      if (!parser) {
        parser = new DrainParser();
        state.parsers.set(row.service, parser);
      }
      parser.restore(row.template, row.id);
    }
    this.states.set(projectId, state);
    return state;
  }

  /** Stores templates the parser created or generalised since the last batch. */
  private async persistDirty(
    projectId: string,
    state: ProjectState,
    stats: Map<Cluster, ClusterStat>,
  ): Promise<void> {
    const pending: { parser: DrainParser; service: string; cluster: Cluster }[] = [];
    for (const [service, parser] of state.parsers) {
      for (const cluster of parser.takeDirty()) pending.push({ parser, service, cluster });
    }

    for (let i = 0; i < pending.length; i++) {
      const { service, cluster } = pending[i];
      try {
        if (cluster.externalId) {
          await this.pool.query("UPDATE log_templates SET template = $1 WHERE id = $2", [
            templateText(cluster),
            cluster.externalId,
          ]);
        } else {
          // Only reached for clusters seen in this batch, so stats always exist.
          const first = new Date(stats.get(cluster)?.minTs ?? Date.now()).toISOString();
          const result = await this.pool.query<{ id: string }>(
            `INSERT INTO log_templates (project_id, service, template, first_seen, last_seen)
             VALUES ($1, $2, $3, $4, $4) RETURNING id::text AS id`,
            [projectId, service, templateText(cluster), first],
          );
          cluster.externalId = result.rows[0].id;
        }
      } catch (error) {
        // Offer the unsaved ones again on the next batch.
        for (const rest of pending.slice(i)) rest.parser.markDirty(rest.cluster);
        throw error;
      }
    }
  }
}
