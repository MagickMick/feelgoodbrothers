import { runMigrations } from "../src/migrate.ts";
import { closeDb } from "../src/db.ts";

await runMigrations();
console.log("✓ migrations applied");
await closeDb();
