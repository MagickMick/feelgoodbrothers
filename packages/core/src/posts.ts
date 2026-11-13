/**
 * Read queries + URL helpers shared by the public site and the admin.
 */
import { and, asc, desc, eq, exists, inArray, lte, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { getDb } from "./db.ts";
import {
  authors,
  categories,
  postCategories,
  posts,
  redirects,
  type Author,
  type Category,
  type Locale,
  type Media,
  type Post,
  type PostKind,
} from "./schema.ts";

export type PostWithRelations = Post & {
  hero: Media | null;
  author: (Author & { avatar: Media | null }) | null;
  categories: Category[];
};

// ---------------------------------------------------------------------------
// URLs (keep identical to the old static site: EN on the root, NL under /nl)
// ---------------------------------------------------------------------------
export const SITE_URL = (process.env.SITE_URL ?? "https://feelgoodbrothers.com").replace(/\/$/, "");

export function postPath(locale: Locale, slug: string): string {
  return locale === "en" ? `/blog/${slug}/` : `/nl/blog/${slug}/`;
}

export function categoryPath(locale: Locale, c: Pick<Category, "slugEn" | "slugNl">): string {
  return locale === "en" ? `/categories/${c.slugEn}/` : `/nl/categorieen/${c.slugNl}/`;
}

export function authorPath(locale: Locale, slug: string): string {
  return locale === "en" ? `/authors/${slug}/` : `/nl/auteurs/${slug}/`;
}

/** name shown on cards and posts: first name / pseudonym for guest stories, author name otherwise */
export function bylineName(p: Pick<PostWithRelations, "kind" | "guestName" | "author">): string | null {
  if (p.kind === "guest") return p.guestName?.trim() || null;
  return p.author?.name ?? null;
}

export function absoluteUrl(pathname: string): string {
  if (/^https?:\/\//.test(pathname)) return pathname;
  return SITE_URL + (pathname.startsWith("/") ? pathname : `/${pathname}`);
}

export function categoryName(locale: Locale, c: Category): string {
  return locale === "en" ? c.nameEn : c.nameNl;
}

export function categorySlug(locale: Locale, c: Category): string {
  return locale === "en" ? c.slugEn : c.slugNl;
}

export function categoryDescription(locale: Locale, c: Category): string {
  return locale === "en" ? c.descriptionEn : c.descriptionNl;
}

// ---------------------------------------------------------------------------
// "live" = not a draft and publishAt has passed. Scheduling needs no cron:
// a scheduled post simply starts matching this condition at publishAt.
// ---------------------------------------------------------------------------
export function liveCondition(): SQL {
  return and(ne(posts.status, "draft"), lte(posts.publishAt, sql`now()`))!;
}

const withRelations = {
  hero: true,
  author: { with: { avatar: true } },
  postCategories: { with: { category: true } },
} as const;

type RawPost = Post & {
  hero: Media | null;
  author: (Author & { avatar: Media | null }) | null;
  postCategories: { category: Category }[];
};

function shape(p: RawPost): PostWithRelations {
  const { postCategories: pc, ...rest } = p;
  return {
    ...rest,
    categories: pc.map((x) => x.category).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

/** for the public site: drop internal data (guest details, AI draft) so it can never end up in a page */
function publicShape(p: RawPost): PostWithRelations {
  return { ...shape(p), guestEmail: null, guestConsentAt: null, guestNote: null, aiDraftBody: null, aiSessionId: null };
}

export interface LivePostsOptions {
  limit?: number;
  categoryId?: number;
  authorId?: number;
  kind?: PostKind;
  excludeIds?: number[];
}

export async function getLivePosts(
  locale: Locale,
  opts: LivePostsOptions = {},
): Promise<PostWithRelations[]> {
  const db = getDb();
  const conditions: SQL[] = [eq(posts.locale, locale), liveCondition()];
  if (opts.authorId) conditions.push(eq(posts.authorId, opts.authorId));
  if (opts.kind) conditions.push(eq(posts.kind, opts.kind));
  if (opts.categoryId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(postCategories)
          .where(
            and(
              eq(postCategories.postId, posts.id),
              eq(postCategories.categoryId, opts.categoryId),
            ),
          ),
      ),
    );
  }
  if (opts.excludeIds?.length) {
    conditions.push(notInArray(posts.id, opts.excludeIds));
  }
  const rows = await db.query.posts.findMany({
    where: and(...conditions),
    with: withRelations,
    orderBy: [desc(posts.publishAt)],
    limit: opts.limit,
  });
  return (rows as RawPost[]).map(publicShape);
}

export async function getLivePostBySlug(
  locale: Locale,
  slug: string,
): Promise<PostWithRelations | null> {
  const row = await getDb().query.posts.findFirst({
    where: and(eq(posts.locale, locale), eq(posts.slug, slug), liveCondition()),
    with: withRelations,
  });
  return row ? publicShape(row as RawPost) : null;
}

/** any post by id (drafts included), for admin previews */
export async function getPostById(id: number): Promise<PostWithRelations | null> {
  const row = await getDb().query.posts.findFirst({
    where: eq(posts.id, id),
    with: withRelations,
  });
  return row ? shape(row as RawPost) : null;
}

/** live versions of the same story in other languages */
export async function getLiveTranslations(
  post: Pick<Post, "id" | "translationGroup">,
): Promise<{ locale: Locale; slug: string }[]> {
  return getDb()
    .select({ locale: posts.locale, slug: posts.slug })
    .from(posts)
    .where(
      and(
        eq(posts.translationGroup, post.translationGroup),
        ne(posts.id, post.id),
        liveCondition(),
      ),
    );
}

/** related posts: share a category first, then fill with the newest posts */
export async function getRelatedPosts(
  post: PostWithRelations,
  limit = 3,
): Promise<PostWithRelations[]> {
  const db = getDb();
  const catIds = post.categories.map((c) => c.id);
  let related: PostWithRelations[] = [];
  if (catIds.length) {
    const rows = await db.query.posts.findMany({
      where: and(
        eq(posts.locale, post.locale),
        liveCondition(),
        ne(posts.id, post.id),
        exists(
          db
            .select({ one: sql`1` })
            .from(postCategories)
            .where(
              and(
                eq(postCategories.postId, posts.id),
                inArray(postCategories.categoryId, catIds),
              ),
            ),
        ),
      ),
      with: withRelations,
      orderBy: [desc(posts.publishAt)],
      limit,
    });
    related = (rows as RawPost[]).map(publicShape);
  }
  if (related.length < limit) {
    const more = await getLivePosts(post.locale, {
      limit: limit - related.length,
      excludeIds: [post.id, ...related.map((p) => p.id)],
    });
    related = [...related, ...more];
  }
  return related;
}

// ---------------------------------------------------------------------------
// categories & authors
// ---------------------------------------------------------------------------
export type CategoryWithCount = Category & { count: number };

/** categories that have at least one live post in this locale, most used first */
export async function getCategoriesWithCounts(locale: Locale): Promise<CategoryWithCount[]> {
  const rows = await getDb()
    .select({ category: categories, count: sql<number>`count(${posts.id})::int` })
    .from(categories)
    .innerJoin(postCategories, eq(postCategories.categoryId, categories.id))
    .innerJoin(posts, and(eq(posts.id, postCategories.postId), eq(posts.locale, locale), liveCondition()))
    .groupBy(categories.id)
    .orderBy(desc(sql`count(${posts.id})`), asc(categories.sortOrder));
  return rows.map((r) => ({ ...r.category, count: r.count }));
}

export async function getCategoryBySlug(locale: Locale, slug: string): Promise<Category | null> {
  const col = locale === "en" ? categories.slugEn : categories.slugNl;
  const [row] = await getDb().select().from(categories).where(eq(col, slug)).limit(1);
  return row ?? null;
}

export async function getAllCategories(): Promise<Category[]> {
  return getDb().select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.nameEn));
}

export async function getAuthorBySlug(slug: string) {
  const row = await getDb().query.authors.findFirst({
    where: eq(authors.slug, slug),
    with: { avatar: true },
  });
  return row ?? null;
}

/** authors with at least one live post in this locale */
export async function getAuthorsWithLivePosts(locale: Locale): Promise<{ slug: string; lastmod: Date | null }[]> {
  return getDb()
    .select({ slug: authors.slug, lastmod: sql<Date | null>`max(${posts.publishAt})` })
    .from(authors)
    .innerJoin(
      posts,
      and(eq(posts.authorId, authors.id), eq(posts.locale, locale), eq(posts.kind, "team"), liveCondition()),
    )
    .groupBy(authors.slug);
}

// ---------------------------------------------------------------------------
// redirects
// ---------------------------------------------------------------------------
export async function findRedirect(pathname: string): Promise<string | null> {
  const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const [row] = await getDb()
    .select({ to: redirects.toPath })
    .from(redirects)
    .where(eq(redirects.fromPath, normalized))
    .limit(1);
  return row?.to ?? null;
}

// ---------------------------------------------------------------------------
// sitemap
// ---------------------------------------------------------------------------
export interface SitemapPost {
  locale: Locale;
  slug: string;
  lastmod: Date;
  translationGroup: string;
  noindex: boolean;
}

export async function getSitemapPosts(): Promise<SitemapPost[]> {
  const rows = await getDb()
    .select({
      locale: posts.locale,
      slug: posts.slug,
      translationGroup: posts.translationGroup,
      noindex: posts.noindex,
      publishAt: posts.publishAt,
      contentUpdatedAt: posts.contentUpdatedAt,
    })
    .from(posts)
    .where(liveCondition())
    .orderBy(desc(posts.publishAt));
  return rows.map((r) => ({
    locale: r.locale,
    slug: r.slug,
    translationGroup: r.translationGroup,
    noindex: r.noindex,
    lastmod: (r.contentUpdatedAt && r.publishAt && r.contentUpdatedAt > r.publishAt
      ? r.contentUpdatedAt
      : r.publishAt) as Date,
  }));
}
