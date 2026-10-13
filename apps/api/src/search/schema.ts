import { z } from "zod";
import { searchConfig } from "./config.js";
import { MAX_CURSOR_LENGTH } from "./cursor.js";
import { parseQuery } from "./parseQuery.js";
import { MAX_QUERY_LENGTH, MAX_SERVICE_LENGTH, type ParsedQuery } from "./types.js";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export const projectIdSchema = z.string().uuid();

// Cheap shape/length checks only; the parser does the real validation (level enum,
// time grammar, NUL bytes, ...) and throws QueryError, which the error middleware maps to 422.
const filterShape = {
  q: z.string().max(MAX_QUERY_LENGTH).optional(),
  level: z.string().max(20).optional(),
  service: z.string().max(MAX_SERVICE_LENGTH).optional(),
  from: z.string().max(64).optional(),
  to: z.string().max(64).optional(),
};

export const filterQuerySchema = z.object(filterShape);

export const logsQuerySchema = z.object({
  ...filterShape,
  cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type FilterQuery = z.infer<typeof filterQuerySchema>;

/** Shared by /logs and /stats/timeseries so both interpret filters identically. */
export function buildFilters(query: FilterQuery, now: Date, startParam: number): ParsedQuery {
  const { maxRangeMs } = searchConfig();
  return parseQuery(query.q ?? "", {
    now,
    startParam,
    maxRangeMs,
    level: query.level,
    service: query.service,
    from: query.from,
    to: query.to,
  });
}
