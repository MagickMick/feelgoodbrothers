import { getDb } from "@fgb/core/db";
import { authors, media } from "@fgb/core/schema";
import { getAllCategories } from "@fgb/core/posts";
import { mediaUrl } from "@fgb/core/storage";
import { asc, eq } from "drizzle-orm";

export async function loadEditorOptions() {
  const db = getDb();
  const [authorRows, categoryRows] = await Promise.all([
    db.select({ id: authors.id, name: authors.name }).from(authors).orderBy(asc(authors.name)),
    getAllCategories(),
  ]);
  return {
    authors: authorRows,
    categories: categoryRows.map((c) => ({ id: c.id, nameEn: c.nameEn, nameNl: c.nameNl })),
  };
}

export async function heroUrlFor(id: number | null): Promise<string | null> {
  if (!id) return null;
  const [m] = await getDb().select().from(media).where(eq(media.id, id)).limit(1);
  return m ? mediaUrl(m, 800) : null;
}
