export const shorthands = undefined;

export async function up(pgm) {
  pgm.createTable("template_minute_counts", {
    template_id: {
      type: "bigint",
      notNull: true,
      references: "log_templates",
      onDelete: "cascade",
    },
    minute: { type: "timestamptz", notNull: true },
    count: { type: "integer", notNull: true },
  });
  pgm.addConstraint("template_minute_counts", "template_minute_counts_pkey", {
    primaryKey: ["template_id", "minute"],
  });
  // Detector asks "which templates were busy in minute m?"
  pgm.createIndex("template_minute_counts", "minute");
}

export async function down(pgm) {
  pgm.dropTable("template_minute_counts");
}
