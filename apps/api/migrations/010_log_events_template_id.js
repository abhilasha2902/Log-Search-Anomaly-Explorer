export const shorthands = undefined;

export async function up(pgm) {
  pgm.addColumn("log_events", {
    template_id: { type: "bigint", references: "log_templates", onDelete: "set null" },
  });
  pgm.createIndex("log_events", ["template_id", { name: "ts", sort: "DESC" }], {
    name: "idx_log_events_template_ts",
  });
}

export async function down(pgm) {
  pgm.dropIndex("log_events", ["template_id", "ts"], { name: "idx_log_events_template_ts" });
  pgm.dropColumn("log_events", "template_id");
}
