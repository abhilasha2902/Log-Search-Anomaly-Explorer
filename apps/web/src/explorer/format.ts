/** "2024-05-01T10:00:00.123456Z" -> "2024-05-01 10:00:00.123" (the column header says UTC). */
export function formatTs(ts: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/.test(ts)
    ? ts.slice(0, 23).replace("T", " ")
    : ts;
}
