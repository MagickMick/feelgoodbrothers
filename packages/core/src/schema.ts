import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const LOCALES = ["en", "nl"] as const;
export type Locale = (typeof LOCALES)[number];

export const localeEnum = pgEnum("locale", LOCALES);
export const postStatusEnum = pgEnum("post_status", ["draft", "scheduled", "published"]);
export type PostStatus = (typeof postStatusEnum.enumValues)[number];
/** team = written by Feelgood Brothers (has an author profile); guest = community story, only a first name / pseudonym is shown */
export const postKindEnum = pgEnum("post_kind", ["team", "guest"]);
export type PostKind = (typeof postKindEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// media: uploaded images. Variants are generated on upload (see storage.ts)
// ---------------------------------------------------------------------------
export const media = pgTable("media", {
  id: serial("id").primaryKey(),
  /** unique base key, files live at /media/<key>-<width>.webp and /media/<key>-og.jpg */
  key: text("key").notNull().unique(),
  originalName: text("original_name"),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  /** widths that were generated (never larger than the original) */
  variants: integer("variants").array().notNull(),
  alt: text("alt").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// authors: the Feelgood Brothers team (guest stories don't get an author profile)
// ---------------------------------------------------------------------------
export const authors = pgTable("authors", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  bioEn: text("bio_en").notNull().default(""),
  bioNl: text("bio_nl").notNull().default(""),
  avatarId: integer("avatar_id").references(() => media.id, { onDelete: "set null" }),
  link: text("link"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// categories: one row per topic, with a slug + name per language so the
// language switcher and hreflang tags can link /categories/x <-> /nl/categorieen/y
// ---------------------------------------------------------------------------
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  slugEn: text("slug_en").notNull().unique(),
  nameEn: text("name_en").notNull(),
  descriptionEn: text("description_en").notNull().default(""),
  slugNl: text("slug_nl").notNull().unique(),
  nameNl: text("name_nl").notNull(),
  descriptionNl: text("description_nl").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------------------------------------------------------------------------
// posts
// ---------------------------------------------------------------------------
export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    locale: localeEnum("locale").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    body: text("body").notNull().default(""),
    heroId: integer("hero_id").references(() => media.id, { onDelete: "set null" }),
    heroAlt: text("hero_alt").notNull().default(""),
    /** the hero photo is illustrative (stock/mood), not taken during the story: shown as a caption */
    heroIllustrative: boolean("hero_illustrative").notNull().default(false),
    authorId: integer("author_id").references(() => authors.id, { onDelete: "set null" }),
    kind: postKindEnum("kind").notNull().default("team"),
    /** guest stories: the only public detail is this first name or pseudonym */
    guestName: text("guest_name"),
    // guest stories, internal only (never rendered on the site)
    guestEmail: text("guest_email"),
    guestConsentAt: timestamp("guest_consent_at", { withTimezone: true }),
    guestNote: text("guest_note"),
    status: postStatusEnum("status").notNull().default("draft"),
    /** when the post is (or will be) live. Scheduled posts go live automatically when publishAt <= now() */
    publishAt: timestamp("publish_at", { withTimezone: true }),
    /** the EN and NL version of the same story share this id */
    translationGroup: uuid("translation_group").notNull().default(sql`gen_random_uuid()`),
    // SEO overrides (fall back to title / description / hero)
    seoTitle: text("seo_title"),
    metaDescription: text("meta_description"),
    canonicalUrl: text("canonical_url"),
    noindex: boolean("noindex").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** last meaningful content change, used for dateModified / sitemap lastmod */
    contentUpdatedAt: timestamp("content_updated_at", { withTimezone: true }),
    /** AI writing assistant: the session this draft came from and the original AI text (marks the post as an AI draft) */
    aiSessionId: integer("ai_session_id"),
    aiDraftBody: text("ai_draft_body"),
  },
  (t) => [
    uniqueIndex("posts_locale_slug_idx").on(t.locale, t.slug),
    index("posts_translation_group_idx").on(t.translationGroup),
    index("posts_status_publish_idx").on(t.status, t.publishAt),
    index("posts_kind_idx").on(t.kind),
  ],
);

export const postCategories = pgTable(
  "post_categories",
  {
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.categoryId] })],
);

// ---------------------------------------------------------------------------
// AI writing assistant
// ---------------------------------------------------------------------------
/** recognisable situations per category ("packed concert", "long line at the supermarket") */
export const situations = pgTable(
  "situations",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    labelEn: text("label_en").notNull(),
    labelNl: text("label_nl").notNull(),
    hintEn: text("hint_en").notNull().default(""),
    hintNl: text("hint_nl").notNull().default(""),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("situations_category_idx").on(t.categoryId)],
);

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiSessionParams {
  categoryIds: number[];
  situationId: number | null;
  situationText: string;
  persona: string;
  length: "short" | "medium" | "long";
  helps: string;
  wishes: string;
  placeholders: boolean;
}

export const aiSessions = pgTable("ai_sessions", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").references(() => posts.id, { onDelete: "set null" }),
  locale: localeEnum("locale").notNull(),
  params: jsonb("params").$type<AiSessionParams>().notNull(),
  messages: jsonb("messages").$type<AiMessage[]>().notNull().default([]),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  /** per-session lock so two tabs can't run a turn at the same time (token of the running turn) */
  turnLock: text("turn_lock"),
  turnStartedAt: timestamp("turn_started_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** one row per AI call (generate, revise, translate): the source for usage reporting */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").references(() => aiSessions.id, { onDelete: "set null" }),
    postId: integer("post_id").references(() => posts.id, { onDelete: "set null" }),
    kind: text("kind").$type<"generate" | "revise" | "translate">().notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_created_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// redirects: 301s for changed slugs (filled automatically by the admin)
// ---------------------------------------------------------------------------
export const redirects = pgTable("redirects", {
  id: serial("id").primaryKey(),
  fromPath: text("from_path").notNull().unique(),
  toPath: text("to_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// admin auth
// ---------------------------------------------------------------------------
export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  /** sha256 of the session token; the raw token only lives in the cookie */
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------
// relations
// ---------------------------------------------------------------------------
export const postsRelations = relations(posts, ({ one, many }) => ({
  hero: one(media, { fields: [posts.heroId], references: [media.id] }),
  author: one(authors, { fields: [posts.authorId], references: [authors.id] }),
  postCategories: many(postCategories),
}));

export const postCategoriesRelations = relations(postCategories, ({ one }) => ({
  post: one(posts, { fields: [postCategories.postId], references: [posts.id] }),
  category: one(categories, { fields: [postCategories.categoryId], references: [categories.id] }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  postCategories: many(postCategories),
}));

export const authorsRelations = relations(authors, ({ one, many }) => ({
  avatar: one(media, { fields: [authors.avatarId], references: [media.id] }),
  posts: many(posts),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(adminUsers, { fields: [sessions.userId], references: [adminUsers.id] }),
}));

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Author = typeof authors.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Media = typeof media.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;

export type Situation = typeof situations.$inferSelect;
export type AiSession = typeof aiSessions.$inferSelect;
