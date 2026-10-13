export const shorthands = undefined;

export async function up(pgm) {
  pgm.createTable("log_templates", {
    id: { type: "bigserial", primaryKey: true },
    project_id: { type: "uuid", notNull: true, references: "projects", onDelete: "cascade" },
    service: { type: "text", notNull: true },
    template: { type: "text", notNull: true },
    first_seen: { type: "timestamptz", notNull: true },
    last_seen: { type: "timestamptz", notNull: true },
    total_count: { type: "bigint", notNull: true, default: 0 },
    example_event_ids: { type: "bigint[]", notNull: true, default: "{}" },
    // Filled in Phase 4 (similar-incident search); null until then.
    embedding: { type: "vector(384)" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("log_templates", ["project_id", "service"]);
  pgm.createIndex("log_templates", ["project_id", { name: "last_seen", sort: "DESC" }]);
}

export async function down(pgm) {
  pgm.dropTable("log_templates");
}
