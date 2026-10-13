export const shorthands = undefined;

export async function up(pgm) {
  pgm.createTable("anomalies", {
    id: { type: "bigserial", primaryKey: true },
    project_id: { type: "uuid", notNull: true, references: "projects", onDelete: "cascade" },
    template_id: {
      type: "bigint",
      notNull: true,
      references: "log_templates",
      onDelete: "cascade",
    },
    type: { type: "text", notNull: true },
    detected_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    score: { type: "double precision", notNull: true },
    window_start: { type: "timestamptz", notNull: true },
    window_end: { type: "timestamptz", notNull: true },
  });
  pgm.addConstraint("anomalies", "anomalies_type_check", {
    check: "type IN ('new_template', 'rate_spike')",
  });
  pgm.createIndex("anomalies", ["project_id", { name: "window_start", sort: "DESC" }]);
  pgm.createIndex("anomalies", ["template_id", "type", { name: "window_end", sort: "DESC" }]);
  // A template can only be "new" once.
  pgm.createIndex("anomalies", "template_id", {
    unique: true,
    where: "type = 'new_template'",
    name: "anomalies_one_new_template_per_template",
  });
}

export async function down(pgm) {
  pgm.dropTable("anomalies");
}
