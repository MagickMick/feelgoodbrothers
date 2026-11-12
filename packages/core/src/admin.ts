/**
 * Write operations used by the admin app.
 */
import { and, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "./db.ts";
import {
  authors,
  categories,
  LOCALES,
  media,
  postCategories,
  posts,
  redirects,
  type Locale,
  type PostKind,
  type PostStatus,
} from "./schema.ts";
import { categoryPath, postPath } from "./posts.ts";
import { slugify } from "./text.ts";
import { deleteImageFiles, processImage } from "./storage.ts";
import { countPlaceholders } from "./ai/prompts.ts";
import { notifyContentChanged } from "./notify.ts";

export class ValidationError extends Error {
  constructor(public fields: Record<string, string>) {
    super(Object.values(fields).join(", "));
  }
}

// ---------------------------------------------------------------------------
// posts
// ---------------------------------------------------------------------------
export interface PostInput {
  locale: Locale;
  title: string;
  slug: string;
  description: string;
  body: string;
  heroId: number | null;
  heroAlt: string;
  authorId: number | null;
  kind: PostKind;
  /** guest stories: first name or pseudonym, the only public detail */
  guestName: string;
  guestEmail: string;
  guestConsentAt: Date | null;
  guestNote: string;
  categoryIds: number[];
  /** what the editor clicked: save draft, schedule, publish now */
  action: "draft" | "schedule" | "publish";
  publishAt: Date | null;
  seoTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  noindex: boolean;
  translationGroup?: string;
}

function isLive(status: PostStatus, publishAt: Date | null): boolean {
  return status !== "draft" && !!publishAt && publishAt <= new Date();
}

function resolveStatus(input: PostInput): { status: PostStatus; publishAt: Date | null } {
  const now = new Date();
  if (input.action === "draft") return { status: "draft", publishAt: input.publishAt };
  if (input.action === "publish") {
    // publish now, or keep an explicit date in the past (e.g. imported / backdated posts)
    const at = input.publishAt && input.publishAt <= now ? input.publishAt : now;
    return { status: "published", publishAt: at };
  }
  // schedule
  if (!input.publishAt) throw new ValidationError({ publishAt: "Kies een datum en tijd om in te plannen" });
  if (input.publishAt <= now) return { status: "published", publishAt: input.publishAt };
  return { status: "scheduled", publishAt: input.publishAt };
}

function validate(input: PostInput): void {
  const errors: Record<string, string> = {};
  if (!LOCALES.includes(input.locale)) errors.locale = "Ongeldige taal";
  if (!input.title.trim()) errors.title = "Titel is verplicht";
  if (!input.slug) errors.slug = "Slug is verplicht";
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug))
    errors.slug = "Alleen kleine letters, cijfers en streepjes";
  if (input.action !== "draft") {
    if (!input.description.trim()) errors.description = "Omschrijving is verplicht om te publiceren";
    if (!input.body.trim()) errors.body = "De blog is nog leeg";
    if (!input.heroId) errors.heroId = "Kies een hoofdafbeelding om te publiceren";
    const open = countPlaceholders(`${input.title}\n${input.description}\n${input.body}`);
    if (open > 0)
      errors.body = `Er ${open === 1 ? "staat nog 1 invulpunt" : `staan nog ${open} invulpunten`} [[...]] in de tekst. Vul ze in of haal ze weg voor je publiceert.`;
  }
  if (input.kind === "guest") {
    if (input.guestName.length > 40) errors.guestName = "Houd het bij een voornaam of pseudoniem (max 40 tekens)";
    if (input.action !== "draft" && !input.guestName) errors.guestName = "Vul de voornaam of het pseudoniem in";
    if (input.guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.guestEmail))
      errors.guestEmail = "Ongeldig e-mailadres";
  }
  if (input.canonicalUrl && !/^https?:\/\//.test(input.canonicalUrl))
    errors.canonicalUrl = "Canonical moet een volledige URL zijn (https://...)";
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

async function assertSlugFree(locale: Locale, slug: string, exceptId?: number) {
  const conditions = [eq(posts.locale, locale), eq(posts.slug, slug)];
  if (exceptId) conditions.push(ne(posts.id, exceptId));
  const [clash] = await getDb().select({ id: posts.id }).from(posts).where(and(...conditions)).limit(1);
  if (clash) throw new ValidationError({ slug: "Deze slug bestaat al in deze taal" });
}

/** add a 301 from -> to and collapse chains (a -> b, b -> c becomes a -> c) */
export async function addRedirect(fromPath: string, toPath: string): Promise<void> {
  if (fromPath === toPath) return;
  const db = getDb();
  await db.update(redirects).set({ toPath }).where(eq(redirects.toPath, fromPath));
  await db.delete(redirects).where(eq(redirects.fromPath, toPath));
  await db
    .insert(redirects)
    .values({ fromPath, toPath })
    .onConflictDoUpdate({ target: redirects.fromPath, set: { toPath } });
}

function affectedPaths(locale: Locale, slug: string): string[] {
  const home = locale === "en" ? "/" : "/nl/";
  return [
    postPath(locale, slug),
    home,
    `${home === "/" ? "" : "/nl"}/blog/`,
    "/sitemap.xml",
    `/sitemap-${locale}.xml`,
  ];
}

export async function savePost(id: number | null, raw: PostInput): Promise<number> {
  const input: PostInput = {
    ...raw,
    title: raw.title.trim(),
    slug: slugify(raw.slug || raw.title),
    description: raw.description.trim(),
    seoTitle: raw.seoTitle.trim(),
    metaDescription: raw.metaDescription.trim(),
    canonicalUrl: raw.canonicalUrl.trim(),
    heroAlt: raw.heroAlt.trim(),
    guestName: raw.guestName.trim(),
    guestEmail: raw.guestEmail.trim().toLowerCase(),
    guestNote: raw.guestNote.trim(),
  };
  validate(input);
  await assertSlugFree(input.locale, input.slug, id ?? undefined);
  const { status, publishAt } = resolveStatus(input);
  const db = getDb();
  const now = new Date();

  const values = {
    locale: input.locale,
    slug: input.slug,
    title: input.title,
    description: input.description,
    body: input.body,
    heroId: input.heroId,
    heroAlt: input.heroAlt,
    kind: input.kind,
    // a guest story never has a team author; a team post never shows a guest name
    authorId: input.kind === "guest" ? null : input.authorId,
    guestName: input.kind === "guest" ? input.guestName || null : null,
    guestEmail: input.kind === "guest" ? input.guestEmail || null : null,
    guestConsentAt: input.kind === "guest" ? input.guestConsentAt : null,
    guestNote: input.kind === "guest" ? input.guestNote || null : null,
    status,
    publishAt,
    seoTitle: input.seoTitle || null,
    metaDescription: input.metaDescription || null,
    canonicalUrl: input.canonicalUrl || null,
    noindex: input.noindex,
    updatedAt: now,
  };

  let postId: number;
  const changed: string[] = [];

  if (id) {
    const [old] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!old) throw new ValidationError({ id: "Post niet gevonden" });
    const wasLive = isLive(old.status, old.publishAt);
    const contentChanged = old.body !== input.body || old.title !== input.title;
    await db
      .update(posts)
      .set({
        ...values,
        // locale can't change after creation (translations are separate posts)
        locale: old.locale,
        contentUpdatedAt: wasLive && contentChanged ? now : old.contentUpdatedAt,
      })
      .where(eq(posts.id, id));
    postId = id;
    if (old.slug !== input.slug && wasLive) {
      await addRedirect(postPath(old.locale, old.slug), postPath(old.locale, input.slug));
      changed.push(postPath(old.locale, old.slug));
    }
    if (wasLive || isLive(status, publishAt)) changed.push(...affectedPaths(old.locale, input.slug));
  } else {
    const [row] = await db
      .insert(posts)
      .values({ ...values, ...(input.translationGroup ? { translationGroup: input.translationGroup } : {}) })
      .returning({ id: posts.id });
    postId = row.id;
    if (isLive(status, publishAt)) changed.push(...affectedPaths(input.locale, input.slug));
  }

  await db.delete(postCategories).where(eq(postCategories.postId, postId));
  const catIds = [...new Set(input.categoryIds)].filter(Boolean);
  if (catIds.length) {
    await db.insert(postCategories).values(catIds.map((categoryId) => ({ postId, categoryId })));
  }

  if (changed.length) void notifyContentChanged(changed);
  return postId;
}

export async function deletePost(id: number): Promise<void> {
  const db = getDb();
  const [old] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!old) return;
  await db.delete(posts).where(eq(posts.id, id));
  if (isLive(old.status, old.publishAt)) void notifyContentChanged(affectedPaths(old.locale, old.slug));
}

/** create a draft in the other language, linked to the same translation group */
export async function createTranslationDraft(id: number): Promise<number> {
  const db = getDb();
  const source = await db.query.posts.findFirst({
    where: eq(posts.id, id),
    with: { postCategories: true },
  });
  if (!source) throw new ValidationError({ id: "Post niet gevonden" });
  const target: Locale = source.locale === "en" ? "nl" : "en";
  const [existing] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.translationGroup, source.translationGroup), eq(posts.locale, target)))
    .limit(1);
  if (existing) return existing.id;

  let slug = source.slug;
  let n = 2;
  while ((await db.select({ id: posts.id }).from(posts).where(and(eq(posts.locale, target), eq(posts.slug, slug)))).length) {
    slug = `${source.slug}-${n++}`;
  }

  const [row] = await db
    .insert(posts)
    .values({
      locale: target,
      slug,
      title: source.title,
      description: source.description,
      body: source.body,
      heroId: source.heroId,
      heroAlt: source.heroAlt,
      authorId: source.authorId,
      kind: source.kind,
      guestName: source.guestName,
      guestEmail: source.guestEmail,
      guestConsentAt: source.guestConsentAt,
      guestNote: source.guestNote,
      status: "draft",
      translationGroup: source.translationGroup,
    })
    .returning({ id: posts.id });
  const catIds = source.postCategories.map((pc) => pc.categoryId);
  if (catIds.length) {
    await db.insert(postCategories).values(catIds.map((categoryId) => ({ postId: row.id, categoryId })));
  }
  return row.id;
}

export interface PostListFilter {
  locale?: Locale;
  kind?: PostKind;
  status?: PostStatus | "live";
  q?: string;
}

export async function listPostsForAdmin(filter: PostListFilter = {}) {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filter.locale) conditions.push(eq(posts.locale, filter.locale));
  if (filter.kind) conditions.push(eq(posts.kind, filter.kind));
  if (filter.status === "live") {
    conditions.push(sql`${posts.status} <> 'draft' and ${posts.publishAt} <= now()`);
  } else if (filter.status === "scheduled") {
    conditions.push(sql`${posts.status} = 'scheduled' and ${posts.publishAt} > now()`);
  } else if (filter.status) {
    conditions.push(eq(posts.status, filter.status));
  }
  if (filter.q) {
    const q = `%${filter.q}%`;
    conditions.push(or(ilike(posts.title, q), ilike(posts.slug, q), ilike(posts.guestName, q))!);
  }
  const rows = await db.query.posts.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    with: { hero: true, author: true },
    orderBy: [sql`${posts.publishAt} desc nulls first`, desc(posts.updatedAt)],
    limit: 500,
  });
  // which translation groups have which locales
  const groups = await db
    .select({ group: posts.translationGroup, locale: posts.locale, id: posts.id })
    .from(posts);
  const byGroup = new Map<string, { locale: Locale; id: number }[]>();
  for (const g of groups) byGroup.set(g.group, [...(byGroup.get(g.group) ?? []), { locale: g.locale, id: g.id }]);
  return rows.map((r) => ({
    ...r,
    translations: (byGroup.get(r.translationGroup) ?? []).filter((t) => t.id !== r.id),
  }));
}

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------
export async function uploadMedia(buffer: Buffer, originalName: string, alt = "") {
  const img = await processImage(buffer, originalName);
  const [row] = await getDb()
    .insert(media)
    .values({ ...img, originalName, alt })
    .returning();
  return row;
}

export async function listMedia(limit = 200) {
  return getDb().select().from(media).orderBy(desc(media.createdAt)).limit(limit);
}

export async function updateMediaAlt(id: number, alt: string) {
  await getDb().update(media).set({ alt: alt.trim() }).where(eq(media.id, id));
}

/** delete media that is not used as hero or avatar */
export async function deleteMedia(id: number): Promise<void> {
  const db = getDb();
  const [usedHero] = await db.select({ id: posts.id }).from(posts).where(eq(posts.heroId, id)).limit(1);
  const [usedAvatar] = await db.select({ id: authors.id }).from(authors).where(eq(authors.avatarId, id)).limit(1);
  if (usedHero || usedAvatar) {
    throw new ValidationError({ media: "Afbeelding is nog in gebruik bij een post of auteur" });
  }
  const [row] = await db.delete(media).where(eq(media.id, id)).returning();
  if (row) await deleteImageFiles(row);
}

// ---------------------------------------------------------------------------
// authors & categories
// ---------------------------------------------------------------------------
export interface AuthorInput {
  name: string;
  slug: string;
  bioEn: string;
  bioNl: string;
  link: string;
  email: string;
  avatarId: number | null;
}

export async function saveAuthor(id: number | null, raw: AuthorInput): Promise<number> {
  const input = { ...raw, name: raw.name.trim(), slug: slugify(raw.slug || raw.name) };
  const errors: Record<string, string> = {};
  if (!input.name) errors.name = "Naam is verplicht";
  if (!input.slug) errors.slug = "Slug is verplicht";
  if (input.link && !/^https?:\/\//.test(input.link)) errors.link = "Link moet met https:// beginnen";
  const db = getDb();
  const [clash] = await db
    .select({ id: authors.id })
    .from(authors)
    .where(id ? and(eq(authors.slug, input.slug), ne(authors.id, id)) : eq(authors.slug, input.slug));
  if (clash) errors.slug = "Deze slug bestaat al";
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const values = {
    name: input.name,
    slug: input.slug,
    bioEn: input.bioEn.trim(),
    bioNl: input.bioNl.trim(),
    link: input.link.trim() || null,
    email: input.email.trim() || null,
    avatarId: input.avatarId,
  };
  if (id) {
    const [old] = await db.select().from(authors).where(eq(authors.id, id));
    await db.update(authors).set(values).where(eq(authors.id, id));
    if (old && old.slug !== input.slug) {
      await addRedirect(`/authors/${old.slug}/`, `/authors/${input.slug}/`);
      await addRedirect(`/nl/auteurs/${old.slug}/`, `/nl/auteurs/${input.slug}/`);
    }
    return id;
  }
  const [row] = await db.insert(authors).values(values).returning({ id: authors.id });
  return row.id;
}

export interface CategoryInput {
  nameEn: string;
  slugEn: string;
  descriptionEn: string;
  nameNl: string;
  slugNl: string;
  descriptionNl: string;
  sortOrder: number;
}

export async function saveCategory(id: number | null, raw: CategoryInput): Promise<number> {
  const input = {
    ...raw,
    nameEn: raw.nameEn.trim(),
    nameNl: raw.nameNl.trim(),
    slugEn: slugify(raw.slugEn || raw.nameEn),
    slugNl: slugify(raw.slugNl || raw.nameNl),
    descriptionEn: raw.descriptionEn.trim(),
    descriptionNl: raw.descriptionNl.trim(),
  };
  const errors: Record<string, string> = {};
  if (!input.nameEn) errors.nameEn = "Engelse naam is verplicht";
  if (!input.nameNl) errors.nameNl = "Nederlandse naam is verplicht";
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const db = getDb();
  if (id) {
    const [old] = await db.select().from(categories).where(eq(categories.id, id));
    try {
      await db.update(categories).set(input).where(eq(categories.id, id));
    } catch {
      throw new ValidationError({ slugEn: "Deze slug bestaat al" });
    }
    if (old) {
      if (old.slugEn !== input.slugEn) await addRedirect(categoryPath("en", old), categoryPath("en", input));
      if (old.slugNl !== input.slugNl) await addRedirect(categoryPath("nl", old), categoryPath("nl", input));
    }
    return id;
  }
  try {
    const [row] = await db.insert(categories).values(input).returning({ id: categories.id });
    return row.id;
  } catch {
    throw new ValidationError({ slugEn: "Deze slug bestaat al" });
  }
}

export async function deleteCategory(id: number): Promise<void> {
  await getDb().delete(categories).where(eq(categories.id, id));
}

export async function listRedirects() {
  return getDb().select().from(redirects).orderBy(desc(redirects.createdAt));
}

export async function deleteRedirect(id: number) {
  await getDb().delete(redirects).where(eq(redirects.id, id));
}
