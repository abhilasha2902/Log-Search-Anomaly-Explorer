export const shorthands = undefined;

export async function up(pgm) {
  // 'simple' config: lowercases and splits on punctuation, no stemming and no
  // stop words, so what you type is what gets matched (whole words only).
  pgm.sql(
    `ALTER TABLE log_events
       ADD COLUMN search_vector tsvector
       GENERATED ALWAYS AS (to_tsvector('simple', message)) STORED`,
  );
  pgm.createIndex("log_events", "search_vector", {
    method: "gin",
    name: "idx_log_events_search_vector",
  });
}

export async function down(pgm) {
  pgm.dropIndex("log_events", "search_vector", { name: "idx_log_events_search_vector" });
  pgm.dropColumn("log_events", "search_vector");
}
