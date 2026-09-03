import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      `DATABASE_URL env var must be set to a Postgres connection string.`
    );
  }

  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      `DATABASE_URL must be a postgres:// or postgresql:// connection string. Got: ${url}`
    );
  }

  return url;
}

const databaseUrl = getDatabaseUrl();
const adapter = new PrismaPg({ connectionString: databaseUrl });

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
