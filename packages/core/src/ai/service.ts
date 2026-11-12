/**
 * Writing assistant: sessions, streaming turns, saving drafts, AI translation.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db.ts";
import {
  aiSessions,
  aiUsage,
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
/** a lock older than this is treated as abandoned (crashed request) */
const TURN_LOCK_MS = 5 * 60 * 1000;
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

/** AI usage in a period, from the per-call ai_usage rows (not the lifetime session counters) */
export async function usageSince(since: Date) {
  const [row] = await getDb()
    .select({
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
    })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, since));
  return row;
}

/**
 * Record the tokens of one AI call once the provider reports them. Runs
 * independently of whether the turn is saved: failed or aborted calls still cost tokens.
 */
function recordUsage(
  usage: Promise<AiUsage>,
  meta: { kind: "generate" | "revise" | "translate"; provider: AiProviderName; sessionId?: number; postId?: number },
): void {
  usage
    .then((u) =>
      getDb()
        .insert(aiUsage)
        .values({
          kind: meta.kind,
          provider: meta.provider,
          model: u.model,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          sessionId: meta.sessionId ?? null,
          postId: meta.postId ?? null,
        }),
    )
    .catch((err) => {
      if (!(err instanceof AiError)) console.error("[ai] could not record usage", err);
    });
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
  const db = getDb();
  // claim the session atomically before calling the AI, so a second tab can't
  // start a parallel turn (which would overwrite this one and cost tokens twice)
  const lock = randomUUID();
  const session = await claimSession(sessionId, lock);
  if (!session) {
    if (!(await getSession(sessionId))) throw new AiError("Sessie niet gevonden");
    throw new AiError("Er loopt al een AI-beurt voor deze opzet (misschien in een ander tabblad). Wacht tot die klaar is.");
  }
  const release = () =>
    db
      .update(aiSessions)
      .set({ turnLock: null, turnStartedAt: null })
      .where(and(eq(aiSessions.id, sessionId), eq(aiSessions.turnLock, lock)))
      .catch(() => undefined);

  try {
    return await startTurn(session, lock, release, feedback, provider);
  } catch (err) {
    await release();
    throw err;
  }
}

async function startTurn(
  session: AiSession,
  lock: string,
  release: () => Promise<unknown>,
  feedback: string | null,
  provider?: AiProviderName,
): Promise<{ text: AsyncGenerator<string>; done: Promise<AiUsage> }> {
  const sessionId = session.id;
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
  recordUsage(stream.usage, {
    kind: session.messages.length === 0 ? "generate" : "revise",
    provider: useProvider,
    sessionId,
  });

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
    try {
      const [usage] = await Promise.all([stream.usage, textFinished]);
      if (!full.trim()) throw new AiError("De AI gaf een leeg antwoord. Probeer het opnieuw.");
      // only save while we still hold the lock (it can expire after TURN_LOCK_MS)
      const saved = await getDb()
        .update(aiSessions)
        .set({
          messages: [...history, { role: "assistant", content: full }],
          provider: useProvider,
          model: usage.model,
          inputTokens: sql`${aiSessions.inputTokens} + ${usage.inputTokens}`,
          outputTokens: sql`${aiSessions.outputTokens} + ${usage.outputTokens}`,
          turnLock: null,
          turnStartedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(aiSessions.id, sessionId), eq(aiSessions.turnLock, lock)))
        .returning({ id: aiSessions.id });
      if (saved.length === 0) {
        throw new AiError("Deze beurt is niet opgeslagen omdat de opzet intussen is gewijzigd. Herlaad de pagina.");
      }
      return usage;
    } catch (err) {
      await release();
      throw err;
    }
  })();
  done.catch(() => undefined);
  return { text: text(), done };
}

/** latest assistant draft of a session, parsed */
export function latestDraft(session: AiSession) {
  const last = [...session.messages].reverse().find((m) => m.role === "assistant");
  return last ? parseDraft(last.content) : null;
}

/** try to take the per-session lock; returns the session row or null when someone else holds it */
async function claimSession(sessionId: number, lock: string): Promise<AiSession | null> {
  const [row] = await getDb()
    .update(aiSessions)
    .set({ turnLock: lock, turnStartedAt: new Date() })
    .where(
      and(
        eq(aiSessions.id, sessionId),
        or(isNull(aiSessions.turnLock), lt(aiSessions.turnStartedAt, new Date(Date.now() - TURN_LOCK_MS))),
      ),
    )
    .returning();
  return row ?? null;
}

function isSlugConflict(err: unknown): boolean {
  if (err instanceof ValidationError) return Boolean(err.fields.slug);
  const cause = (err as { cause?: { code?: string } })?.cause;
  return cause?.code === "23505";
}

/**
 * Save the latest draft as a post draft and return its id.
 * Uses the session lock, so a double click or a second tab gets the same post
 * back, and you can't save while the AI is still writing.
 */
export async function saveSessionAsDraft(sessionId: number, authorId: number | null): Promise<number> {
  const db = getDb();
  const lock = randomUUID();
  let session: AiSession | null = null;
  for (let attempt = 0; attempt < 25 && !session; attempt++) {
    session = await claimSession(sessionId, lock);
    if (session) break;
    const current = await getSession(sessionId);
    if (!current) throw new AiError("Sessie niet gevonden");
    if (current.postId) return current.postId; // saved by the other request
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!session) throw new AiError("De AI is nog bezig met deze opzet. Wacht tot hij klaar is en probeer het opnieuw.");

  try {
    if (session.postId) return session.postId;
    const draft = latestDraft(session);
    if (!draft?.body) throw new AiError("Er is nog geen opzet om op te slaan.");

    const base = slugify(draft.slug || draft.title) || `concept-${sessionId}`;
    let id: number | null = null;
    for (let n = 1; id === null; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      const [clash] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.locale, session.locale), eq(posts.slug, slug)));
      if (clash) continue;
      try {
        id = await savePost(null, {
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
      } catch (err) {
        // someone else took this slug between our check and the insert: try the next one
        if (isSlugConflict(err) && n < 20) continue;
        throw err;
      }
    }
    await db.update(posts).set({ aiSessionId: sessionId, aiDraftBody: draft.body }).where(eq(posts.id, id));
    await db.update(aiSessions).set({ postId: id, updatedAt: new Date() }).where(eq(aiSessions.id, sessionId));
    return id;
  } finally {
    await db
      .update(aiSessions)
      .set({ turnLock: null, turnStartedAt: null })
      .where(and(eq(aiSessions.id, sessionId), eq(aiSessions.turnLock, lock)));
  }
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
  recordUsage(stream.usage, { kind: "translate", provider, postId });
  let full = "";
  for await (const chunk of stream.text) full += chunk;
  await stream.usage; // surfaces provider errors after the text
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

  return row.id;
}
