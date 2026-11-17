/**
 * Run a starter-data seed at most once per database.
 *
 * The marker row and the seed are written in one transaction, so a failed seed is retried on the
 * next start. The seed itself still checks for an empty table: databases that were seeded before
 * markers existed get their marker without new rows.
 */
import { getDb } from "./db.ts";
import { seedMarkers } from "./schema.ts";

export type SeedTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function seedOnce(key: string, seed: (tx: SeedTx) => Promise<number>): Promise<number> {
  return getDb().transaction(async (tx) => {
    const claimed = await tx.insert(seedMarkers).values({ key }).onConflictDoNothing().returning();
    if (claimed.length === 0) return 0; // seeded before: respect whatever the editor did since
    return seed(tx);
  });
}
