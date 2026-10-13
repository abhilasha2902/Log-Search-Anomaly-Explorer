export const LEVELS = ["debug", "info", "warn", "error"] as const;
export type Level = (typeof LEVELS)[number];

export const MAX_QUERY_LENGTH = 500;
export const MAX_TOKENS = 20;
export const MAX_SERVICE_LENGTH = 100;

/** Thrown for any user-input problem; routes map it to a 422. */
export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}

export interface ParsedQuery {
  /** SQL conditions to AND together. Built only from constant text and `$n` placeholders. */
  where: string[];
  /** Values for the placeholders, in order, starting at `startParam`. */
  params: unknown[];
  filters: {
    levels: Level[];
    services: string[];
    from: Date | null;
    to: Date | null;
  };
}

export interface ParseOptions {
  /** Injected so the parser stays pure; read once per request by the caller. */
  now: Date;
  /** Index of the first `$n` placeholder this fragment may use (default 1). */
  startParam?: number;
  /** Cap for relative offsets and for the (to - from) span. */
  maxRangeMs: number;
  /** Explicit URL params, AND-ed with whatever the `q` string contains. */
  level?: string;
  service?: string;
  from?: string;
  to?: string;
}
