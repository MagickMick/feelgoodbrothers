/**
 * One-off import of the old MDX blog posts (packages/core/seed) into Postgres.
 * Idempotent: categories are upserted, existing posts (locale + slug) are skipped.
 *
 *   npm run import-mdx
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import matter from "gray-matter";
import { and, eq } from "drizzle-orm";
import { getDb, closeDb } from "../src/db.ts";
import { runMigrations } from "../src/migrate.ts";
import { authors, categories, media, postCategories, posts, type Locale } from "../src/schema.ts";
import { processImage } from "../src/storage.ts";
import { seedSituations } from "../src/ai/situations-seed.ts";

const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../seed");

// categories: same slugs as the old routeTranslations, so category URLs stay the same
const CATEGORY_SEED = [
  { slugEn: "panic-attacks", nameEn: "Panic attacks", slugNl: "paniek-aanvallen", nameNl: "Paniekaanvallen" },
  { slugEn: "anxiety", nameEn: "Anxiety", slugNl: "angst", nameNl: "Angst" },
  { slugEn: "depression", nameEn: "Depression", slugNl: "depressie", nameNl: "Depressie" },
  { slugEn: "derealization", nameEn: "Derealization", slugNl: "derealisatie", nameNl: "Derealisatie" },
  { slugEn: "high-sensitivity", nameEn: "High sensitivity", slugNl: "hoogsensitiviteit", nameNl: "Hoogsensitiviteit" },
  { slugEn: "mindfulness", nameEn: "Mindfulness", slugNl: "mindfulness", nameNl: "Mindfulness" },
  { slugEn: "mindset", nameEn: "Mindset", slugNl: "mindset", nameNl: "Mindset" },
  { slugEn: "meditation", nameEn: "Meditation", slugNl: "meditatie", nameNl: "Meditatie" },
  { slugEn: "yoga", nameEn: "Yoga", slugNl: "yoga", nameNl: "Yoga" },
  { slugEn: "addiction", nameEn: "Addiction", slugNl: "verslaving", nameNl: "Verslaving" },
];

// EN <-> NL pairs (from the old translationData.json.ts route keys)
const PAIRS: [string, string][] = [
  ["have-not-had-such-a-severe-panic-attack-in-a-long-time", "zo-een-erge-paniek-aanval-heb-ik-allang-niet-meer-gehad"],
  ["out-of-body-experience", "out-of-body-ervaring"],
  ["feeling-and-taking-responsibility-for-your-own-emotions", "verantwoordelijkheid-eigen-emoties-voelen-en-nemen"],
  ["christmas-markets-paradise-for-high-sensitive-people-with-panic-attacks", "kerstmarkten-walhalla-voor-hoog-sensitieve-personen-met-paniek-aanvallen"],
  ["scared-to-pass-out-while-have-a-panic-attack", "bang-voor-flauwvallen-tijdens-paniekaanval"],
  ["panic-attacks-when-driving", "paniekaanval-tijdens-het-auto-rijden"],
  ["living-life-with-mindfulness", "met-mindfulness-door-het-leven"],
];

const db = getDb();

async function importImage(file: string, alt: string): Promise<number> {
  const buf = await readFile(file);
  const img = await processImage(buf, path.basename(file));
  const [row] = await db
    .insert(media)
    .values({ ...img, originalName: path.basename(file), alt })
    .returning({ id: media.id });
  return row.id;
}

async function main() {
  await runMigrations();

  // categories
  for (const [i, c] of CATEGORY_SEED.entries()) {
    await db
      .insert(categories)
      .values({ ...c, sortOrder: i })
      .onConflictDoNothing({ target: categories.slugEn });
  }
  const allCats = await db.select().from(categories);
  console.log(`✓ ${allCats.length} categories`);

  // authors
  const authorIds = new Map<string, number>();
  for (const slug of await readdir(path.join(SEED, "authors"))) {
    const dir = path.join(SEED, "authors", slug);
    const { data } = matter(await readFile(path.join(dir, "index.mdx"), "utf8"));
    const [existing] = await db.select().from(authors).where(eq(authors.slug, slug));
    if (existing) {
      authorIds.set(slug, existing.id);
      continue;
    }
    const avatarId = await importImage(path.resolve(dir, path.basename(data.avatar)), data.name);
    const [row] = await db
      .insert(authors)
      .values({
        slug,
        name: data.name,
        bioEn: "Sharing my personal stories about my mental health challenges: panic attacks, derealization, and what helps me cope.",
        bioNl: "Ik deel mijn persoonlijke verhalen over mijn mentale uitdagingen: paniekaanvallen, derealisatie en wat mij helpt.",
        email: data.email,
        avatarId,
      })
      .returning({ id: authors.id });
    authorIds.set(slug, row.id);
  }
  console.log(`✓ ${authorIds.size} authors`);

  // translation groups
  const groups = new Map<string, string>();
  for (const [en, nl] of PAIRS) {
    const id = randomUUID();
    groups.set(`en/${en}`, id);
    groups.set(`nl/${nl}`, id);
  }

  let imported = 0;
  let skipped = 0;
  for (const locale of ["en", "nl"] as Locale[]) {
    for (const slug of await readdir(path.join(SEED, "blog", locale))) {
      const dir = path.join(SEED, "blog", locale, slug);
      const { data, content } = matter(await readFile(path.join(dir, "index.mdx"), "utf8"));
      if (data.draft === true) continue;

      const [existing] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.locale, locale), eq(posts.slug, slug)));
      if (existing) {
        skipped++;
        continue;
      }

      const heroAlt = String(data.title);
      const heroId = await importImage(path.resolve(dir, path.basename(String(data.heroImage))), heroAlt);
      const publishAt = new Date(`${String(data.pubDate instanceof Date ? data.pubDate.toISOString().slice(0, 10) : data.pubDate)}T09:00:00+01:00`);

      const [post] = await db
        .insert(posts)
        .values({
          locale,
          slug,
          title: String(data.title),
          description: String(data.description ?? "").trim(),
          body: content.trim() + "\n",
          heroId,
          heroAlt,
          authorId: authorIds.get(data.authors?.[0]) ?? null,
          status: "published",
          publishAt,
          translationGroup: groups.get(`${locale}/${slug}`) ?? randomUUID(),
          contentUpdatedAt: data.updatedDate ? new Date(data.updatedDate) : null,
        })
        .returning({ id: posts.id });

      const catSlugs: string[] = data.categories ?? [];
      for (const cs of catSlugs) {
        const cat = allCats.find((c) => (locale === "en" ? c.slugEn : c.slugNl) === cs);
        if (cat) {
          await db.insert(postCategories).values({ postId: post.id, categoryId: cat.id }).onConflictDoNothing();
        } else {
          console.warn(`  ! unknown category "${cs}" in ${locale}/${slug}`);
        }
      }
      imported++;
      console.log(`  + ${locale}/${slug}`);
    }
  }
  console.log(`✓ imported ${imported} posts (${skipped} already existed)`);
  const seeded = await seedSituations();
  if (seeded) console.log(`✓ ${seeded} situations for the writing assistant`);
}

try {
  await main();
} finally {
  await closeDb();
}
