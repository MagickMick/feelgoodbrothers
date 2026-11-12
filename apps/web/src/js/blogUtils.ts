/**
 * Thin, cached wrappers around @fgb/core for the public site.
 */
import {
  getCategoriesWithCounts,
  type CategoryWithCount,
  type Locale,
} from "@fgb/core/posts";

export * from "@fgb/core/posts";

// categories are used on almost every page (nav, category cloud). Cache them
// for a few seconds per process so a page render doesn't hit the DB 3 times.
const CACHE_MS = 15_000;
const categoryCache = new Map<Locale, { at: number; data: Promise<CategoryWithCount[]> }>();

export function getCategoriesCached(locale: Locale): Promise<CategoryWithCount[]> {
  const hit = categoryCache.get(locale);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = getCategoriesWithCounts(locale).catch((err) => {
    categoryCache.delete(locale);
    throw err;
  });
  categoryCache.set(locale, { at: Date.now(), data });
  return data;
}

