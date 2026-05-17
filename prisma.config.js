/**
 * Prisma config for Replit + CI.
 * Replit may inject a Postgres DATABASE_URL automatically; this project uses SQLite.
 * Prefer SQLITE_DATABASE_URL; fall back to DATABASE_URL only if it's a file: URL.
 */
require("dotenv/config");

function getDatasourceUrl() {
  const url =
    process.env.SQLITE_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "file:./prisma/dev.db";

  // Guard: refuse Postgres URLs so failures are loud and obvious.
  if (/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      `Prisma is configured for SQLite, but a Postgres DATABASE_URL was provided.\n` +
      `Set SQLITE_DATABASE_URL to a file: URL (e.g. file:./prisma/dev.db).\n` +
      `Got: ${url}`
    );
  }

  // Guard: SQLite must start with file:
  if (!/^file:/i.test(url)) {
    throw new Error(`SQLite datasource URL must start with "file:". Got: ${url}`);
  }

  return url;
}

module.exports = {
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: getDatasourceUrl() },
};
