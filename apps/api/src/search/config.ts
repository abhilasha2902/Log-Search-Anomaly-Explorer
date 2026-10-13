const DAY_MS = 86_400_000;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Read at call time so tests (and a restart with new env) take effect without re-importing. */
export function searchConfig(): { maxRangeMs: number; statementTimeoutMs: number } {
  return {
    maxRangeMs: positiveInt(process.env.SEARCH_MAX_RANGE_DAYS, 30) * DAY_MS,
    statementTimeoutMs: positiveInt(process.env.SEARCH_STATEMENT_TIMEOUT_MS, 5000),
  };
}
