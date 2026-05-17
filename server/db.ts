import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

function getDatabaseUrl(): string {
  const url =
    process.env.SQLITE_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "file:./prisma/dev.db";

  if (/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      `SQLite app detected a Postgres DATABASE_URL.\n` +
      `Set SQLITE_DATABASE_URL to a file: URL (e.g. file:./prisma/dev.db).\n` +
      `Got: ${url}`
    );
  }

  if (!/^file:/i.test(url)) {
    throw new Error(`SQLite datasource URL must start with "file:". Got: ${url}`);
  }

  return url;
}

const databaseUrl = getDatabaseUrl();
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });

const globalForPrisma = globalThis as unknown as {
  prisma: InstanceType<typeof PrismaClient> | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
