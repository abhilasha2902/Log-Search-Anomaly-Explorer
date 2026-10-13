import { z } from "zod";

export const MAX_BATCH_SIZE = 1000;

export const logEventSchema = z.object({
  ts: z.string().datetime(),
  service: z.string().min(1).max(100),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string().min(1).max(10_000),
  attrs: z.record(z.string(), z.unknown()).optional().default({}),
});

export const ingestBatchSchema = z.array(logEventSchema).min(1).max(MAX_BATCH_SIZE);

export type LogEvent = z.infer<typeof logEventSchema>;
