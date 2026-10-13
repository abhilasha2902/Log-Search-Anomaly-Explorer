export const API_BASE = "/api";

export interface User {
  id: string;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
}

export type Level = "debug" | "info" | "warn" | "error";

export interface LogItem {
  id: string;
  ts: string;
  service: string;
  level: Level;
  message: string;
  attrs: Record<string, unknown>;
}

export interface LogsPage {
  items: LogItem[];
  nextCursor: string | null;
}

/** The filters shared by the logs list (and later the chart); all are optional strings. */
export interface SearchFilters {
  q?: string;
  level?: string;
  service?: string;
  from?: string;
  to?: string;
}

export interface TimeseriesBucket {
  /** Start of the minute, e.g. "2024-05-01T10:03:00Z". Minutes with no events are omitted. */
  t: string;
  count: number;
}

export interface Timeseries {
  from: string;
  to: string;
  buckets: TimeseriesBucket[];
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** The auth provider registers this so any 401 sends the user back to the login page. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
  }
  return `Request failed (${status})`;
}

async function request<T>(
  path: string,
  init: NonNullable<Parameters<typeof fetch>[1]> = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.();
    throw new ApiError(response.status, errorMessage(response.status, body), body);
  }
  return body as T;
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const api = {
  me: () => request<User>("/me"),
  register: (email: string, password: string) =>
    request<User>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<User>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  listProjects: () => request<Project[]>("/projects"),
  createProject: (name: string) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify({ name }) }),
  getTimeseries: (projectId: string, filters: SearchFilters) =>
    request<Timeseries>(
      `/projects/${encodeURIComponent(projectId)}/stats/timeseries${toQueryString({ ...filters })}`,
    ),
  getLogs: (projectId: string, filters: SearchFilters, cursor?: string, limit?: number) =>
    request<LogsPage>(
      `/projects/${encodeURIComponent(projectId)}/logs${toQueryString({ ...filters, cursor, limit })}`,
    ),
};
