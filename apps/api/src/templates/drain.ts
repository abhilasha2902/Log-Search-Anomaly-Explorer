import { WILDCARD, tokenize } from "./mask.js";

export interface DrainOptions {
  /** Tree depth: 1 level for the token count plus (depth - 2) leading tokens. Default 3 (token count + first token). */
  depth?: number;
  /** Fraction of positions that must match for a line to join an existing template. Default 0.7. */
  similarityThreshold?: number;
  /** Max distinct children per tree node before extra tokens share the wildcard child. Default 100. */
  maxChildren?: number;
}

export interface Cluster {
  tokens: string[];
  /** Lines merged into this template since the parser was created (not persisted). */
  size: number;
  /** Set by the caller once the template is stored (the parser itself never touches a DB). */
  externalId?: string;
}

export interface ParseResult {
  cluster: Cluster;
  created: boolean;
  /** True when this line generalised an existing template (a token became `<*>`). */
  changed: boolean;
}

interface Node {
  children: Map<string, Node>;
  clusters: Cluster[];
}

const newNode = (): Node => ({ children: new Map(), clusters: [] });

export function templateText(cluster: Cluster): string {
  return cluster.tokens.join(" ");
}

/**
 * A small Drain-style online log parser. Lines are grouped first by token count, then by their
 * first token (a fixed-depth tree), and inside a leaf each line is compared with the
 * existing templates: if enough positions match, the line joins that template and any position
 * that differs becomes `<*>`; otherwise it starts a new template.
 */
export class DrainParser {
  private readonly prefixLength: number;
  private readonly threshold: number;
  private readonly maxChildren: number;
  private readonly byLength = new Map<number, Node>();
  private readonly dirty = new Set<Cluster>();
  private clusterCount = 0;

  constructor(options: DrainOptions = {}) {
    this.prefixLength = Math.max(0, (options.depth ?? 3) - 2);
    this.threshold = options.similarityThreshold ?? 0.7;
    this.maxChildren = options.maxChildren ?? 100;
  }

  get size(): number {
    return this.clusterCount;
  }

  parse(line: string): ParseResult {
    const tokens = tokenize(line);
    const leaf = this.leafFor(tokens);

    const best = this.bestMatch(leaf, tokens);
    if (best) {
      let changed = false;
      for (let i = 0; i < tokens.length; i++) {
        if (best.tokens[i] !== WILDCARD && best.tokens[i] !== tokens[i]) {
          best.tokens[i] = WILDCARD;
          changed = true;
        }
      }
      best.size++;
      if (changed) this.dirty.add(best);
      return { cluster: best, created: false, changed };
    }

    const cluster: Cluster = { tokens: [...tokens], size: 1 };
    leaf.clusters.push(cluster);
    this.clusterCount++;
    this.dirty.add(cluster);
    return { cluster, created: true, changed: false };
  }

  /** Rebuilds a template that was stored earlier (after a restart). Does not mark it dirty. */
  restore(template: string, externalId: string): Cluster {
    const tokens = template.split(" ").filter((token) => token.length > 0);
    const leaf = this.leafFor(tokens);
    const same = leaf.clusters.find(
      (c) => c.tokens.length === tokens.length && c.tokens.every((t, i) => t === tokens[i]),
    );
    if (same) {
      same.externalId ??= externalId;
      return same;
    }
    const cluster: Cluster = { tokens, size: 0, externalId };
    leaf.clusters.push(cluster);
    this.clusterCount++;
    return cluster;
  }

  /** Templates created or changed since the last call. The caller persists them. */
  takeDirty(): Cluster[] {
    const out = [...this.dirty];
    this.dirty.clear();
    return out;
  }

  /** Call when persisting a taken cluster failed, so it is offered again next time. */
  markDirty(cluster: Cluster): void {
    this.dirty.add(cluster);
  }

  private leafFor(tokens: string[]): Node {
    let node: Node = this.byLength.get(tokens.length) ?? newNode();
    this.byLength.set(tokens.length, node);
    const levels = Math.min(this.prefixLength, tokens.length);
    for (let i = 0; i < levels; i++) {
      // A token that contains a masked value is too variable to branch on.
      const key = tokens[i].includes(WILDCARD) ? WILDCARD : tokens[i];
      // Classic Drain: an unseen literal falls into the wildcard branch if there is one.
      let child: Node | undefined =
        node.children.get(key) ?? (key === WILDCARD ? undefined : node.children.get(WILDCARD));
      if (!child) {
        const target = key === WILDCARD || node.children.size >= this.maxChildren ? WILDCARD : key;
        child = node.children.get(target);
        if (!child) {
          child = newNode();
          node.children.set(target, child);
        }
      }
      node = child;
    }
    return node;
  }

  private bestMatch(leaf: Node, tokens: string[]): Cluster | undefined {
    let best: Cluster | undefined;
    let bestSim = -1;
    let bestSame = -1;
    for (const cluster of leaf.clusters) {
      // A wildcard position in the template accepts any token, so it counts as a match.
      let same = 0;
      let matched = 0;
      for (let i = 0; i < tokens.length; i++) {
        if (cluster.tokens[i] === tokens[i]) {
          same++;
          matched++;
        } else if (cluster.tokens[i] === WILDCARD) {
          matched++;
        }
      }
      const sim = tokens.length === 0 ? 1 : matched / tokens.length;
      // Prefer the closest template; on a tie, the one with more literal (non-wildcard) matches.
      if (sim > bestSim || (sim === bestSim && same > bestSame)) {
        best = cluster;
        bestSim = sim;
        bestSame = same;
      }
    }
    return best && bestSim >= this.threshold ? best : undefined;
  }
}
