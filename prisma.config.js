/**
 * Prisma config for Replit + CI.
 * This project uses Replit's provisioned Postgres database (DATABASE_URL).
 */
require("dotenv/config");

function getDatasourceUrl() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(`DATABASE_URL env var must be set to a Postgres connection string.`);
  }

  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      `DATABASE_URL must be a postgres:// or postgresql:// connection string. Got: ${url}`
    );
  }

  return url;
}

module.exports = {
  schema: "prisma/schema.prisma",
  datasource: { url: getDatasourceUrl() },
};
