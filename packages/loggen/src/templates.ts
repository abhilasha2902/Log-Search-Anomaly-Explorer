export type Service = "api" | "payments" | "auth" | "db";
export type Level = "debug" | "info" | "warn" | "error";

export interface Template {
  id: string;
  service: Service;
  level: Level;
  render: (rng: () => number) => string;
  attrs: (rng: () => number) => Record<string, unknown>;
  baselineWeight: number;
}

function randomInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export const TEMPLATES: Template[] = [
  {
    id: "api_info_request",
    service: "api",
    level: "info",
    render: (rng) => `GET /orders/${randomInt(rng, 1, 9999)} 200`,
    attrs: (rng) => ({ duration_ms: randomInt(rng, 5, 80) }),
    baselineWeight: 70,
  },
  {
    id: "api_warn_slow",
    service: "api",
    level: "warn",
    render: (rng) => `GET /orders/${randomInt(rng, 1, 9999)} took longer than expected`,
    attrs: (rng) => ({ duration_ms: randomInt(rng, 300, 800) }),
    baselineWeight: 8,
  },
  {
    id: "api_error_500",
    service: "api",
    level: "error",
    render: () => "Unhandled error handling request",
    attrs: () => ({}),
    baselineWeight: 2,
  },
  {
    id: "payments_info_charge",
    service: "payments",
    level: "info",
    render: (rng) => `charge ch_${randomInt(rng, 100000, 999999)} succeeded`,
    attrs: () => ({}),
    baselineWeight: 60,
  },
  {
    id: "payments_warn_retry",
    service: "payments",
    level: "warn",
    render: (rng) => `charge ch_${randomInt(rng, 100000, 999999)} retried`,
    attrs: () => ({}),
    baselineWeight: 6,
  },
  {
    id: "payments_error_timeout",
    service: "payments",
    level: "error",
    render: () => "timeout calling downstream payment processor",
    attrs: () => ({}),
    baselineWeight: 2,
  },
  {
    id: "auth_info_login",
    service: "auth",
    level: "info",
    render: (rng) => `user u_${randomInt(rng, 1000, 9999)} logged in`,
    attrs: () => ({}),
    baselineWeight: 50,
  },
  {
    id: "auth_warn_failed",
    service: "auth",
    level: "warn",
    render: (rng) => `failed login attempt for u_${randomInt(rng, 1000, 9999)}`,
    attrs: () => ({}),
    baselineWeight: 7,
  },
  {
    id: "auth_error_lockout",
    service: "auth",
    level: "error",
    render: (rng) => `account u_${randomInt(rng, 1000, 9999)} locked after repeated failures`,
    attrs: () => ({}),
    baselineWeight: 1,
  },
  {
    id: "db_info_query",
    service: "db",
    level: "info",
    render: () => "query completed",
    attrs: (rng) => ({ duration_ms: randomInt(rng, 2, 40) }),
    baselineWeight: 55,
  },
  {
    id: "db_warn_slow_query",
    service: "db",
    level: "warn",
    render: () => "slow query detected",
    attrs: (rng) => ({ duration_ms: randomInt(rng, 200, 500) }),
    baselineWeight: 5,
  },
  {
    id: "db_error_conn",
    service: "db",
    level: "error",
    render: () => "connection pool exhausted",
    attrs: () => ({}),
    baselineWeight: 1,
  },
];

// Only ever emitted during the "bad deploy" incident window - never appears
// in the baseline, which is what makes it detectable as a brand-new template.
export const BAD_DEPLOY_TEMPLATE: Template = {
  id: "api_error_null_pointer",
  service: "api",
  level: "error",
  render: (rng) => `NullPointerException in handler /orders/${randomInt(rng, 1, 9999)}`,
  attrs: () => ({}),
  baselineWeight: 0,
};

export const ALL_TEMPLATES = [...TEMPLATES, BAD_DEPLOY_TEMPLATE];
