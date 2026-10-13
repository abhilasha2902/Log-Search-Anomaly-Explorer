import "./env.js";
import pino from "pino";
import { createPool } from "./db.js";
import { loadDetectorConfig } from "./detector/config.js";
import { detectAll } from "./detector/detect.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const config = loadDetectorConfig();
const pool = createPool();

let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let wake: (() => void) | undefined;

async function tick(): Promise<void> {
  const started = Date.now();
  try {
    const summary = await detectAll(pool, new Date(), config, (projectId, error) => {
      // Name and message only: the error object can carry query parameters.
      const e = error as { name?: unknown; message?: unknown } | null;
      logger.error({ projectId, err: { name: e?.name, message: e?.message } }, "detection failed");
    });
    logger.info({ ...summary, ms: Date.now() - started }, "detection run finished");
  } catch (error) {
    const e = error as { name?: unknown; message?: unknown } | null;
    logger.error({ err: { name: e?.name, message: e?.message } }, "detection run failed");
  }
}

async function main(): Promise<void> {
  logger.info({ intervalMs: config.workerIntervalMs }, "worker started");
  // The next run starts one interval after the previous one finished, so runs never overlap.
  while (!stopping) {
    await tick();
    if (stopping) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, config.workerIntervalMs);
    });
  }
  await pool.end();
  logger.info("worker stopped");
}

function stop(): void {
  stopping = true;
  if (timer) clearTimeout(timer);
  wake?.();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

main().catch((error: unknown) => {
  logger.error({ err: { message: (error as Error)?.message } }, "worker crashed");
  process.exit(1);
});
