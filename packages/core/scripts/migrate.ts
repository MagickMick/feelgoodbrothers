import { runMigrations } from "../src/migrate.ts";
import { closeDb } from "../src/db.ts";
import { seedSituations } from "../src/ai/situations-seed.ts";
import { seedWritingStyles } from "../src/ai/styles-seed.ts";

await runMigrations();
console.log("✓ migrations applied");
const seeded = await seedSituations();
if (seeded) console.log(`✓ ${seeded} situations seeded`);
const styles = await seedWritingStyles();
if (styles) console.log(`✓ ${styles} writing styles seeded`);
await closeDb();
