import { randomBytes, createHash } from "node:crypto";

export interface GeneratedApiKey {
  fullKey: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const fullKey = randomBytes(32).toString("base64url");
  const prefix = fullKey.slice(0, 8);
  const hash = hashApiKey(fullKey);
  return { fullKey, prefix, hash };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
