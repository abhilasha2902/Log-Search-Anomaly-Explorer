export const shorthands = undefined;

export async function up(pgm) {
  pgm.createExtension("pgcrypto", { ifNotExists: true });
  pgm.createExtension("vector", { ifNotExists: true });
}

export async function down(pgm) {
  pgm.dropExtension("vector", { ifExists: true });
  pgm.dropExtension("pgcrypto", { ifExists: true });
}
