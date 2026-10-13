export const shorthands = undefined;

export async function up(pgm) {
  pgm.createTable("log_events", {
    id: { type: "bigserial", primaryKey: true },
    project_id: { type: "uuid", notNull: true, references: "projects", onDelete: "cascade" },
    ts: { type: "timestamptz", notNull: true },
    service: { type: "text", notNull: true },
    level: { type: "text", notNull: true },
    message: { type: "text", notNull: true },
    attrs: { type: "jsonb", notNull: true, default: "{}" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("log_events", ["project_id", { name: "ts", sort: "DESC" }], {
    name: "idx_log_events_project_ts",
  });
  pgm.createIndex(
    "log_events",
    ["project_id", "service", "level", { name: "ts", sort: "DESC" }],
    { name: "idx_log_events_project_service_level_ts" },
  );
  pgm.createIndex("log_events", "attrs", { method: "gin", name: "idx_log_events_attrs_gin" });
}

export async function down(pgm) {
  pgm.dropTable("log_events");
}
