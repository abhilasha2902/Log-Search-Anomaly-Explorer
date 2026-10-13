export const shorthands = undefined;

export async function up(pgm) {
  pgm.createTable("projects", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    name: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("projects", "user_id");
}

export async function down(pgm) {
  pgm.dropTable("projects");
}
