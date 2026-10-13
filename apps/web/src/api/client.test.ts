import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setUnauthorizedHandler } from "./client.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("calls the /api prefix and always sends cookies", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "u1" }));
    await expect(api.me()).resolves.toEqual({ id: "u1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/me");
    expect(init.credentials).toBe("include");
  });

  it("sends JSON bodies with a content type", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "u1" }));
    await api.login("a@example.com", "password123");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ email: "a@example.com", password: "password123" });
  });

  it("builds the logs URL, encoding values and skipping empty ones", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [], nextCursor: null }));
    await api.getLogs(
      "p 1",
      { q: 'level:error "disk full"', level: "", service: "api" },
      "abc",
      50,
    );
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/api/projects/p%201/logs");
    expect(parsed.searchParams.get("q")).toBe('level:error "disk full"');
    expect(parsed.searchParams.get("service")).toBe("api");
    expect(parsed.searchParams.get("cursor")).toBe("abc");
    expect(parsed.searchParams.get("limit")).toBe("50");
    expect(parsed.searchParams.has("level")).toBe(false);
  });

  it("throws ApiError carrying the status and server message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, { error: "invalid_query", message: "from must be earlier than to" }),
    );
    const error = await api.getLogs("p1", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, message: "from must be earlier than to" });
  });

  it("calls the unauthorized handler on a 401", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthenticated" }));
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
