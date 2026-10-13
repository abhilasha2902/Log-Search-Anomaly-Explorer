export const shorthands = undefined;

export async function up(pgm) {
  pgm.createTable("api_keys", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    project_id: { type: "uuid", notNull: true, references: "projects", onDelete: "cascade" },
    key_hash: { type: "text", notNull: true },
    key_prefix: { type: "text", notNull: true },
    revoked_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("api_keys", "project_id");
  pgm.createIndex("api_keys", "key_prefix");
}

export async function down(pgm) {
  pgm.dropTable("api_keys");
}
