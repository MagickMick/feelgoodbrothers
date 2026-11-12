/**
 * Writing assistant: sessions, streaming turns, saving drafts, AI translation.
 */
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "../db.ts";
import {
  aiSessions,
  categories,
  postCategories,
  posts,
  situations,
  type AiMessage,
  type AiSession,
  type AiSessionParams,
  type Locale,
} from "../schema.ts";
import { getLivePosts } from "../posts.ts";
import { savePost, ValidationError } from "../admin.ts";
import { slugify } from "../text.ts";
import { AiError, modelFor, streamChat, type AiProviderName, type AiUsage } from "./provider.ts";
import {
  buildGenerateMessage,
  buildReviseMessage,
  buildSystemPrompt,
  buildTranslateMessage,
  buildTranslateSystem,
  parseDraft,
  type VoiceSample,
} from "./prompts.ts";

export const MAX_TURNS = 20;
const MAX_OUTPUT_TOKENS = 16000; // reasoning models count thinking tokens here too

// ---------------------------------------------------------------------------
// situations
// ---------------------------------------------------------------------------
export async function listSituations(opts: { activeOnly?: boolean } = {}) {
  const db = getDb();
  return db
    .select()
    .from(situations)
    .where(opts.activeOnly ? eq(situations.active, true) : undefined)
    .orderBy(asc(situations.categoryId), asc(situations.sortOrder), asc(situations.id));
}

/** random active situation for these categories, preferring ones used least in earlier sessions */
export async function pickSituation(categoryIds: number[]) {
  const db = getDb();
  const candidates = await db
    .select()
    .from(situations)
    .where(
      and(
        eq(situations.active, true),
        categoryIds.length ? inArray(situations.categoryId, categoryIds) : undefined,
      ),
    );
  if (candidates.length === 0) return null;
  const used = await db
    .select({ id: sql<number>`(${aiSessions.params}->>'situationId')::int`, n: sql<number>`count(*)::int` })
    .from(aiSessions)
    .groupBy(sql`(${aiSessions.params}->>'situationId')::int`);
  const usage = new Map(used.map((u) => [u.id, u.n]));
  const min = Math.min(...candidates.map((c) => usage.get(c.id) ?? 0));
  const least = candidates.filter((c) => (usage.get(c.id) ?? 0) === min);
  return least[Math.floor(Math.random() * least.length)];
}

export async function saveSituation(
  id: number | null,
  v: { categoryId: number; labelEn: string; labelNl: string; hintEn: string; hintNl: string; active: boolean },
) {
  const values = {
    categoryId: v.categoryId,
    labelEn: v.labelEn.trim(),
    labelNl: v.labelNl.trim(),
    hintEn: v.hintEn.trim(),
    hintNl: v.hintNl.trim(),
    active: v.active,
  };
  if (!values.labelEn || !values.labelNl) {
    throw new ValidationError({ label: "Vul de situatie in het Engels en Nederlands in" });
  }
  const db = getDb();
  if (id) await db.update(situations).set(values).where(eq(situations.id, id));
  else await db.insert(situations).values(values);
}

export async function deleteSituation(id: number) {
  await getDb().delete(situations).where(eq(situations.id, id));
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
async function voiceSamples(locale: Locale): Promise<VoiceSample[]> {
  const recent = await getLivePosts(locale, { kind: "team", limit: 2 });
  return recent.map((p) => ({ title: p.title, body: p.body }));
}

async function categoryNames(locale: Locale, ids: number[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await getDb().select().from(categories).where(inArray(categories.id, ids));
  return rows.map((c) => (locale === "nl" ? c.nameNl : c.nameEn));
}

async function situationLabel(locale: Locale, params: AiSessionParams): Promise<string> {
  if (params.situationText.trim()) return params.situationText.trim();
  if (!params.situationId) return "";
  const [s] = await getDb().select().from(situations).where(eq(situations.id, params.situationId));
  if (!s) return "";
  const label = locale === "nl" ? s.labelNl : s.labelEn;
  const hint = locale === "nl" ? s.hintNl : s.hintEn;
  return hint ? `${label} (${hint})` : label;
}

export async function createSession(locale: Locale, params: AiSessionParams, provider: AiProviderName) {
  const [row] = await getDb()
    .insert(aiSessions)
    .values({ locale, params, provider, model: modelFor(provider), messages: [] })
    .returning();
  return row;
}

export async function getSession(id: number): Promise<AiSession | null> {
  const [row] = await getDb().select().from(aiSessions).where(eq(aiSessions.id, id));
  return row ?? null;
}

export async function listRecentSessions(limit = 15) {
  return getDb().select().from(aiSessions).orderBy(desc(aiSessions.updatedAt)).limit(limit);
}

export async function usageSince(since: Date) {
  const [row] = await getDb()
    .select({
      sessions: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiSessions.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiSessions.outputTokens}), 0)::int`,
    })
    .from(aiSessions)
    .where(gte(aiSessions.createdAt, since));
  return row;
}

/**
 * Run one turn: the first turn generates the draft from the session params,
 * later turns apply `feedback`. Streams text; the turn is saved when the stream ends.
 */
export async function runTurn(
  sessionId: number,
  feedback: string | null,
  provider?: AiProviderName,
): Promise<{ text: AsyncGenerator<string>; done: Promise<AiUsage> }> {
  const session = await getSession(sessionId);
  if (!session) throw new AiError("Sessie niet gevonden");
  const turns = session.messages.filter((m) => m.role === "user").length;
  if (turns >= MAX_TURNS) throw new AiError(`Maximaal ${MAX_TURNS} beurten per sessie. Start een nieuwe opzet.`);

  const locale = session.locale;
  const useProvider = provider ?? (session.provider as AiProviderName);
  let userMessage: string;
  if (session.messages.length === 0) {
    userMessage = buildGenerateMessage({
      locale,
      categoryNames: await categoryNames(locale, session.params.categoryIds),
      situation: await situationLabel(locale, session.params),
      params: session.params,
    });
  } else {
    if (!feedback?.trim()) throw new AiError("Typ wat er anders moet.");
    userMessage = buildReviseMessage(feedback.trim());
  }

  const history: AiMessage[] = [...session.messages, { role: "user", content: userMessage }];
  const system = buildSystemPrompt(locale, await voiceSamples(locale), session.params.placeholders);
  const stream = await streamChat(useProvider, { system, messages: history, maxTokens: MAX_OUTPUT_TOKENS });

  let full = "";
  let finishText!: () => void;
  let failText!: (reason: unknown) => void;
  const textFinished = new Promise<void>((resolve, reject) => {
    finishText = resolve;
    failText = reject;
  });
  async function* text() {
    let completed = false;
    try {
      for await (const chunk of stream.text) {
        full += chunk;
        yield chunk;
      }
      completed = true;
    } catch (err) {
      failText(err);
      throw err;
    } finally {
      if (completed) finishText();
      else failText(new AiError("De generatie is afgebroken."));
    }
  }
  const done = (async () => {
    const [usage] = await Promise.all([stream.usage, textFinished]);
    if (!full.trim()) throw new AiError("De AI gaf een leeg antwoord. Probeer het opnieuw.");
    await getDb()
      .update(aiSessions)
      .set({
        messages: [...history, { role: "assistant", content: full }],
        provider: useProvider,
        model: usage.model,
        inputTokens: sql`${aiSessions.inputTokens} + ${usage.inputTokens}`,
        outputTokens: sql`${aiSessions.outputTokens} + ${usage.outputTokens}`,
        updatedAt: new Date(),
      })
      .where(eq(aiSessions.id, sessionId));
    return usage;
  })();
  done.catch(() => undefined);
  return { text: text(), done };
}

/** latest assistant draft of a session, parsed */
export function latestDraft(session: AiSession) {
  const last = [...session.messages].reverse().find((m) => m.role === "assistant");
  return last ? parseDraft(last.content) : null;
}

/** save the latest draft as a post draft and return its id */
export async function saveSessionAsDraft(sessionId: number, authorId: number | null): Promise<number> {
  const session = await getSession(sessionId);
  if (!session) throw new AiError("Sessie niet gevonden");
  if (session.postId) return session.postId;
  const draft = latestDraft(session);
  if (!draft?.body) throw new AiError("Er is nog geen opzet om op te slaan.");

  // make the slug unique in this locale
  const db = getDb();
  const base = slugify(draft.slug || draft.title) || `concept-${sessionId}`;
  let slug = base;
  for (let n = 2; ; n++) {
    const [clash] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.locale, session.locale), eq(posts.slug, slug)));
    if (!clash) break;
    slug = `${base}-${n}`;
  }

  const id = await savePost(null, {
    locale: session.locale,
    title: draft.title || "AI-opzet",
    slug,
    description: draft.description,
    body: draft.body,
    heroId: null,
    heroAlt: draft.heroAlt,
    authorId,
    kind: "team",
    guestName: "",
    guestEmail: "",
    guestConsentAt: null,
    guestNote: "",
    categoryIds: session.params.categoryIds,
    action: "draft",
    publishAt: null,
    seoTitle: "",
    metaDescription: "",
    canonicalUrl: "",
    noindex: false,
  });
  await db.update(posts).set({ aiSessionId: sessionId, aiDraftBody: draft.body }).where(eq(posts.id, id));
  await db.update(aiSessions).set({ postId: id, updatedAt: new Date() }).where(eq(aiSessions.id, sessionId));
  return id;
}

// ---------------------------------------------------------------------------
// translation
// ---------------------------------------------------------------------------
/**
 * Create the other-language version of a post, translated by AI, as a linked draft.
 * Returns the new post id (or the existing translation's id).
 */
export async function translatePostWithAi(postId: number, provider: AiProviderName): Promise<number> {
  const db = getDb();
  const source = await db.query.posts.findFirst({ where: eq(posts.id, postId), with: { postCategories: true } });
  if (!source) throw new AiError("Post niet gevonden");
  const target: Locale = source.locale === "en" ? "nl" : "en";
  const [existing] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.translationGroup, source.translationGroup), eq(posts.locale, target)));
  if (existing) return existing.id;

  const stream = await streamChat(provider, {
    system: buildTranslateSystem(target),
    messages: [{ role: "user", content: buildTranslateMessage(source) }],
    maxTokens: MAX_OUTPUT_TOKENS,
  });
  let full = "";
  for await (const chunk of stream.text) full += chunk;
  const usage = await stream.usage;
  const draft = parseDraft(full);
  if (!draft.body) throw new AiError("De vertaling is mislukt (leeg antwoord). Probeer het opnieuw.");

  const base = slugify(draft.slug || draft.title) || source.slug;
  let slug = base;
  for (let n = 2; ; n++) {
    const [clash] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.locale, target), eq(posts.slug, slug)));
    if (!clash) break;
    slug = `${base}-${n}`;
  }

  const [row] = await db
    .insert(posts)
    .values({
      locale: target,
      slug,
      title: draft.title || source.title,
      description: draft.description || source.description,
      body: draft.body,
      heroId: source.heroId,
      heroAlt: draft.heroAlt || source.heroAlt,
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
  if (catIds.length) await db.insert(postCategories).values(catIds.map((categoryId) => ({ postId: row.id, categoryId })));

  // log the tokens as a small session so monthly usage stays complete
  await db.insert(aiSessions).values({
    postId: row.id,
    locale: target,
    params: {
      categoryIds: catIds,
      situationId: null,
      situationText: `Vertaling van post ${postId}`,
      persona: "",
      length: "medium",
      helps: "",
      wishes: "",
      placeholders: false,
    },
    messages: [],
    provider,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
  return row.id;
}
