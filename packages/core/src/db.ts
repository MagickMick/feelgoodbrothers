import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type DB = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __fgbDb?: DB; __fgbSql?: postgres.Sql };

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

/** shared drizzle instance (one connection pool per process, survives dev HMR) */
export function getDb(): DB {
  if (!globalForDb.__fgbDb) {
    const client = postgres(databaseUrl(), {
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      idle_timeout: 30,
      onnotice: () => {},
    });
    globalForDb.__fgbSql = client;
    globalForDb.__fgbDb = drizzle(client, { schema });
  }
  return globalForDb.__fgbDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__fgbSql?.end({ timeout: 5 });
  globalForDb.__fgbSql = undefined;
  globalForDb.__fgbDb = undefined;
}

export { schema };
