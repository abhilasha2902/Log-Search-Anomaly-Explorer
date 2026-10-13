export const WILDCARD = "<*>";

// Order matters: specific shapes first, so "10.0.0.1:80" is one wildcard, not four digit runs.
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g;
const HEX_PREFIXED = /\b0x[0-9a-f]+\b/gi;
// 8+ hex characters that include at least one digit (so plain words like "deadbeef" survive).
const LONG_HEX = /\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi;
const NUMBER = /\d+(?:\.\d+)?/g;

/** Upper bounds keep one huge line from costing more than a normal one. */
export const MAX_CHARS = 2000;
export const MAX_TOKENS = 64;

/** Replaces the parts of a line that vary per event (ids, addresses, numbers) with `<*>`. */
export function maskLine(line: string): string {
  return line
    .slice(0, MAX_CHARS)
    .replace(UUID, WILDCARD)
    .replace(IPV4, WILDCARD)
    .replace(HEX_PREFIXED, WILDCARD)
    .replace(LONG_HEX, WILDCARD)
    .replace(NUMBER, WILDCARD);
}

export function tokenize(line: string): string[] {
  return maskLine(line)
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .slice(0, MAX_TOKENS);
}
