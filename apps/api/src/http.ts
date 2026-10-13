import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import pino from "pino";
import { QueryError } from "./search/types.js";

const logger = pino({ level: process.env.NODE_ENV === "test" ? "silent" : "info" });

/**
 * Express 4 does not catch rejected promises from async handlers; without this a
 * failed DB query would be an unhandled rejection (which crashes Node). Wrapped
 * handlers forward the error to the error middleware below instead.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Postgres error code for statement_timeout ("query_canceled"). */
const PG_QUERY_CANCELED = "57014";

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof QueryError) {
    res.status(422).json({ error: "invalid_query", message: err.message });
    return;
  }
  const code = (err as { code?: unknown } | null)?.code;
  if (code === PG_QUERY_CANCELED) {
    res.status(503).json({ error: "search_timeout" });
    return;
  }
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: "bad_request" });
    return;
  }
  // Log name/message/code only: never the request, which may carry cookies or keys.
  const e = err as { name?: unknown; message?: unknown } | null;
  logger.error({ err: { name: e?.name, message: e?.message, code } }, "unhandled request error");
  res.status(500).json({ error: "internal" });
};
