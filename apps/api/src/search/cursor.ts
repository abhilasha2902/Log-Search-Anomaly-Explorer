import { z } from "zod";
import { QueryError } from "./types.js";

export const MAX_CURSOR_LENGTH = 200;

// Postgres timestamptz keeps microseconds; the cursor carries the exact text so
// the keyset comparison never loses precision to a JS Date.
const cursorSchema = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  i: z.string().regex(/^\d{1,18}$/),
});

export type Cursor = z.infer<typeof cursorSchema>;

/** Opaque to clients: base64url of {t: timestamp text, i: row id}. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  if (value.length > MAX_CURSOR_LENGTH) throw new QueryError("invalid cursor");
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new QueryError("invalid cursor");
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success) throw new QueryError("invalid cursor");
  return parsed.data;
}
