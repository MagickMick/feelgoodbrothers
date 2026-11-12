import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getDb } from "./db.ts";

/**
 * Run pending SQL migrations from packages/core/drizzle.
 * MIGRATIONS_DIR can override the location (used inside the Docker image).
 */
export async function runMigrations(): Promise<void> {
  const migrationsFolder =
    process.env.MIGRATIONS_DIR ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
  await migrate(getDb(), { migrationsFolder });
}
