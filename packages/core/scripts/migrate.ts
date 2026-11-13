import { runMigrations } from "../src/migrate.ts";
import { closeDb } from "../src/db.ts";
import { seedSituations } from "../src/ai/situations-seed.ts";

await runMigrations();
console.log("✓ migrations applied");
const seeded = await seedSituations();
if (seeded) console.log(`✓ ${seeded} situations seeded`);
await closeDb();
