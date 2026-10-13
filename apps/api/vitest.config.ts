import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one real Postgres and truncate tables between
    // tests; running files in parallel races those truncations against each
    // other's in-flight requests.
    fileParallelism: false,
    // The auth rate limiter is meant to throttle production abuse, not the
    // test suite's own repeated register/login calls.
    env: {
      AUTH_RATE_LIMIT_MAX: "1000",
    },
    // A dead/unreachable DB should fail a test fast, not hang the whole run.
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
