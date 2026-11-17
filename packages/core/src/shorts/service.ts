/**
 * Shorts: a vertical animated video per post (YouTube Shorts / Reels).
 *
 * The server only does the AI work: a storyboard script, one illustration per scene,
 * the voice per scene and word timings for the captions. The animation itself is
 * rendered in the editor's browser (Remotion, apps/admin/src/shorts-video), so the
 * shared 1-CPU server never renders video.
 *
 * Without an OpenAI key, or with AI_PROVIDER=mock, everything is faked for free:
 * a fixed storyboard, coloured placeholder images and silent audio.
 */
import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import sharp from "sharp";
import { getDb } from "../db.ts";
import { aiUsage, posts, shorts, type Locale, type Short } from "../schema.ts";
import { uploadsDir } from "../storage.ts";
import { absoluteUrl, postPath } from "../posts.ts";
import { AiError, defaultProvider, streamChat } from "../ai/provider.ts";
import { deleteAudioFile, mapLimit, mp3Frames, silentMp3, speechConfig, ttsChunk } from "../ai/speech.ts";
import {
  alignAssets,
  emptySceneAssets,
  estimateWords,
  MOTIONS,
  EFFECTS,
  normalizeStoryboard,
  parseStoryboardJson,
  sceneStatus,
  type SceneAssets,
  type ShortAssets,
  type Storyboard,
  type Word,
} from "./types.ts";

const BUSY_MS = 10 * 60 * 1000;
const PARALLEL = 3;

export const IMAGE_STYLE =
  "Flat 2D editorial illustration, soft paper grain texture, warm muted palette (cream, sand, soft orange, muted teal), gentle shading, simple shapes, calm and empathetic mood, simple faceless characters without facial features. Vertical composition with the main subject in the middle and some empty space at the top and bottom. Absolutely no text, letters, numbers, captions, signs with writing or logos.";

function isMock(): boolean {
  return process.env.AI_PROVIDER === "mock" || !process.env.OPENAI_API_KEY;
}

function imageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
}

// ---------------------------------------------------------------------------
// script
// ---------------------------------------------------------------------------
function scriptSystem(locale: Locale): string {
  const lang = locale === "nl" ? "Dutch (natural, informal)" : "American English";
  return `You turn a personal mental health blog post into a storyboard for a 30 to 45 second vertical animated short (YouTube Shorts / Reels) for Feelgood Brothers.

Write all viewer-facing text (hook, narration, cta, youtube) in ${lang}. Write "character" and every "imagePrompt" in English.

The short:
- Is told in the first person by the author ("I"), as a condensed, honest version of the story. Keep the author's real situation and details; do not invent new events.
- The first scene must hook within 2 seconds: start in the middle of the moment.
- 4 to 6 scenes. Narration per scene is 1 or 2 short spoken sentences; all narration together 85 to 110 words.
- Ends on what helped or how it felt afterwards, hopeful but not cheesy, no advice to the viewer.
- No clinical jargon, no medical or medication advice, never any self-harm or suicide methods or imagery.

Per scene:
- narration: what the voice says.
- imagePrompt: a concrete visual description of ONE illustration for this moment (setting, what the character does, body language, light). Never ask for text in the image. Do not describe the art style (that is added automatically).
- motion: one of ${MOTIONS.join(", ")} (camera movement over the illustration).
- effect: one of ${EFFECTS.join(", ")}. heartbeat = racing heart/panic peak, tunnel = tunnel vision or derealization, rain = rain or heavy mood, particles = calm or dreamy, breathe = breathing to calm down, none = otherwise. Use effects sparingly.
- emphasis: 1 to 3 key words from that narration that light up in the captions.

Also:
- hook: max 8 words, shown big over the first scene, makes people stay.
- character: one fixed English description of the main character (age range, build, hair, clothes) so every illustration shows the same person. Faceless style.
- cta: one short line inviting to read the full story on feelgoodbrothers.com.
- youtube.title: max 70 characters, honest and curiosity-making, may include one emoji, ends with #shorts.
- youtube.description: 2 or 3 sentences about the story, then a line inviting to read the full story (the link is added automatically), then the line "${locale === "nl" ? "Illustraties en stem gemaakt met AI. Dit is een persoonlijke ervaring, geen medisch advies." : "Illustrations and voice made with AI. This is a personal experience, not medical advice."}"
- youtube.hashtags: 5 to 8 relevant hashtags without the # sign.

Answer with only one JSON object, no text around it:
{"hook": "...", "character": "...", "scenes": [{"narration": "...", "imagePrompt": "...", "motion": "zoom-in", "effect": "none", "emphasis": ["..."]}], "cta": "...", "youtube": {"title": "...", "description": "...", "hashtags": ["..."]}}`;
}

function trimWords(text: string, max: number): string {
  const w = text.split(/\s+/);
  return w.length <= max ? text : `${w.slice(0, max).join(" ")} …`;
}

function mockStoryboard(locale: Locale, title: string): Storyboard {
  const nl = locale === "nl";
  const scene = (i: number, effect: string, motion: string) => ({
    narration: nl ? `Dit is testscène ${i}. Mijn hart begon sneller te kloppen.` : `This is test scene ${i}. My heart started racing.`,
    imagePrompt: `Test scene ${i}: a person in a busy place`,
    motion,
    effect,
    emphasis: [nl ? "hart" : "heart"],
  });
  return normalizeStoryboard({
    hook: `Test: ${title}`.slice(0, 60),
    character: "man in his thirties, short dark hair, dark green hoodie",
    scenes: [scene(1, "none", "zoom-in"), scene(2, "heartbeat", "pan-left"), scene(3, "tunnel", "zoom-out"), scene(4, "breathe", "float")],
    cta: nl ? "Lees het hele verhaal op feelgoodbrothers.com" : "Read the full story on feelgoodbrothers.com",
    youtube: {
      title: `${title} #shorts`.slice(0, 100),
      description: nl ? "Testbeschrijving." : "Test description.",
      hashtags: ["mentalhealth", "anxiety", "shorts"],
    },
  });
}

/** add the post link to the YouTube description */
function withLink(sb: Storyboard, post: { locale: Locale; slug: string }): Storyboard {
  const url = `${absoluteUrl(postPath(post.locale, post.slug))}?utm_source=youtube&utm_medium=shorts`;
  if (sb.youtube.description.includes(url)) return sb;
  const label = post.locale === "nl" ? "Lees het hele verhaal:" : "Read the full story:";
  return { ...sb, youtube: { ...sb.youtube, description: `${sb.youtube.description}\n\n${label} ${url}`.trim() } };
}

async function writeScript(post: { id: number; locale: Locale; title: string; body: string; slug: string }): Promise<Storyboard> {
  if (isMock()) return withLink(mockStoryboard(post.locale, post.title), post);
  const provider = defaultProvider();
  const stream = await streamChat(provider, {
    system: scriptSystem(post.locale),
    messages: [{ role: "user", content: `Title: ${post.title}\n\n${trimWords(post.body, 1800)}` }],
    maxTokens: 8000,
  });
  let text = "";
  for await (const chunk of stream.text) text += chunk;
  const usage = await stream.usage;
  await getDb()
    .insert(aiUsage)
    .values({ kind: "short-script", provider, model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, postId: post.id })
    .catch(() => undefined);
  try {
    return withLink(parseStoryboardJson(text), post);
  } catch (err) {
    throw new AiError((err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export async function getShort(id: number): Promise<Short | null> {
  const [row] = await getDb().select().from(shorts).where(eq(shorts.id, id));
  return row ?? null;
}

export async function listShorts(limit = 50) {
  return getDb()
    .select({ short: shorts, title: posts.title, slug: posts.slug })
    .from(shorts)
    .innerJoin(posts, eq(posts.id, shorts.postId))
    .orderBy(desc(shorts.updatedAt))
    .limit(limit);
}

export async function listShortsForPost(postId: number) {
  return getDb().select().from(shorts).where(eq(shorts.postId, postId)).orderBy(desc(shorts.updatedAt));
}

/** create a short for a post and write its script */
export async function createShort(postId: number): Promise<number> {
  const db = getDb();
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post) throw new AiError("Blog niet gevonden");
  if (post.body.split(/\s+/).length < 80) throw new AiError("De blog is te kort voor een short.");
  if (/\[\[[^\]]*\]\]/.test(post.body)) throw new AiError("Er staan nog invulpunten [[…]] in de blog. Vul die eerst in.");
  const storyboard = await writeScript(post);
  const [row] = await db
    .insert(shorts)
    .values({ postId, locale: post.locale, storyboard, assets: alignAssets(storyboard, null) })
    .returning({ id: shorts.id });
  return row.id;
}

/** claim the short for AI work; throws when another job runs */
async function claim(id: number): Promise<Short> {
  const db = getDb();
  const [row] = await db
    .update(shorts)
    .set({ busySince: new Date() })
    .where(and(eq(shorts.id, id), or(isNull(shorts.busySince), lt(shorts.busySince, new Date(Date.now() - BUSY_MS)))))
    .returning();
  if (row) return row;
  if (!(await getShort(id))) throw new AiError("Short niet gevonden");
  throw new AiError("Er wordt al aan deze short gewerkt. Wacht tot dat klaar is.");
}

async function release(id: number, fields: Partial<typeof shorts.$inferInsert> = {}) {
  await getDb()
    .update(shorts)
    .set({ ...fields, busySince: null, updatedAt: new Date() })
    .where(eq(shorts.id, id));
}

/**
 * Save storyboard edits from the editor (no AI). `sceneMap[i]` is the index of the old
 * scene that new scene i came from (-1 = new scene), so illustrations and voices stay
 * with their scene when scenes are removed or added.
 */
export async function saveStoryboard(id: number, raw: unknown, sceneMap?: unknown): Promise<Short> {
  let storyboard: Storyboard;
  try {
    storyboard = normalizeStoryboard(raw, { strict: true });
  } catch (err) {
    throw new AiError((err as Error).message);
  }
  const short = await claim(id);
  const old = short.assets.scenes;
  const map =
    Array.isArray(sceneMap) && sceneMap.length === storyboard.scenes.length
      ? sceneMap.map((j) => (Number.isInteger(j) && j >= 0 && j < old.length ? Number(j) : -1))
      : storyboard.scenes.map((_, i) => (i < old.length ? i : -1));
  // an old scene can only be used once
  const seen = new Set<number>();
  const assets: ShortAssets = {
    scenes: map.map((j) => {
      if (j < 0 || seen.has(j)) return emptySceneAssets();
      seen.add(j);
      return old[j];
    }),
  };
  await deleteSceneFiles(old.filter((_, j) => !seen.has(j)));
  await release(id, { storyboard, assets });
  return (await getShort(id))!;
}

/** write a new script (keeps nothing of the old scenes) */
export async function rewriteScript(id: number): Promise<Short> {
  const short = await claim(id);
  try {
    const [post] = await getDb().select().from(posts).where(eq(posts.id, short.postId));
    if (!post) throw new AiError("Blog niet gevonden");
    const storyboard = await writeScript(post);
    await deleteSceneFiles(short.assets.scenes);
    await release(id, { storyboard, assets: alignAssets(storyboard, null), error: null });
  } catch (err) {
    await release(id);
    throw err;
  }
  return (await getShort(id))!;
}

export async function deleteShort(id: number): Promise<void> {
  const short = await getShort(id);
  if (!short) return;
  if (short.busySince && short.busySince.getTime() > Date.now() - BUSY_MS) {
    throw new AiError("Er wordt nu aan deze short gewerkt. Wacht tot dat klaar is.");
  }
  await getDb().delete(shorts).where(eq(shorts.id, id));
  await deleteSceneFiles(short.assets.scenes);
}

/** remove the files of all shorts of a post (call before the post is deleted) */
export async function deleteShortFilesForPost(postId: number): Promise<void> {
  for (const s of await listShortsForPost(postId)) await deleteSceneFiles(s.assets.scenes);
}

async function deleteImageFile(key: string | null) {
  if (key && /^short-[a-z0-9-]+$/.test(key)) await unlink(path.join(uploadsDir(), `${key}.webp`)).catch(() => undefined);
}

async function deleteSceneFiles(scenes: SceneAssets[]) {
  for (const s of scenes) {
    await deleteImageFile(s.imageKey);
    await deleteAudioFile(s.audioKey);
  }
}

// ---------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------
const MOCK_COLOURS = ["#e8d5b7", "#c9b29b", "#9fb8ad", "#e3a587", "#b8c5d6", "#d9c3a5", "#a7b7a0"];

async function makeImage(shortId: number, index: number, prompt: string, character: string): Promise<string> {
  const key = `short-${shortId}-${index}-${randomBytes(4).toString("hex")}`;
  let png: Buffer;
  if (isMock()) {
    const colour = MOCK_COLOURS[index % MOCK_COLOURS.length];
    // no text: the container has no fonts. Scene n gets n dots so scenes are easy to tell apart.
    const dots = Array.from({ length: index + 1 }, (_, d) => `<circle cx="${512 + (d - index / 2) * 90}" cy="768" r="34" fill="#333" fill-opacity="0.55"/>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><rect width="100%" height="100%" fill="${colour}"/><circle cx="512" cy="768" r="220" fill="#fff" fill-opacity="0.45"/>${dots}</svg>`;
    png = await sharp(Buffer.from(svg)).png().toBuffer();
  } else {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();
    const model = imageModel();
    try {
      const res = await client.images.generate({
        model,
        prompt: `${IMAGE_STYLE}\n\nMain character (same person in every scene): ${character}\n\nScene: ${prompt}`,
        size: "1024x1536",
        quality: "medium",
        n: 1,
      });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new AiError("OpenAI gaf geen afbeelding terug.");
      png = Buffer.from(b64, "base64");
      await getDb()
        .insert(aiUsage)
        .values({
          kind: "short-image",
          provider: "openai",
          model,
          inputTokens: res.usage?.input_tokens ?? 0,
          outputTokens: res.usage?.output_tokens ?? 0,
        })
        .catch(() => undefined);
    } catch (err) {
      if (err instanceof AiError) throw err;
      if (err instanceof OpenAI.BadRequestError) throw new AiError(`OpenAI weigerde de illustratie voor scène ${index + 1}: ${err.message}. Pas de beeldbeschrijving aan.`);
      if (err instanceof OpenAI.AuthenticationError) throw new AiError("OpenAI: de API-key is ongeldig.");
      if (err instanceof OpenAI.RateLimitError) throw new AiError("OpenAI: limiet bereikt of tegoed op. Probeer het later opnieuw.");
      if (err instanceof OpenAI.NotFoundError) throw new AiError(`OpenAI: het beeldmodel "${model}" bestaat niet (meer). Pas OPENAI_IMAGE_MODEL aan.`);
      if (err instanceof OpenAI.APIError) throw new AiError(`OpenAI-fout (${err.status ?? "?"}): ${err.message}`);
      throw new AiError("Kon OpenAI niet bereiken.");
    }
  }
  await sharp(png).webp({ quality: 86 }).toFile(path.join(uploadsDir(), `${key}.webp`));
  return key;
}

async function transcribeWords(mp3: Uint8Array, locale: Locale): Promise<Word[] | null> {
  try {
    const { default: OpenAI, toFile } = await import("openai");
    const client = new OpenAI();
    const res = await client.audio.transcriptions.create({
      file: await toFile(mp3, "scene.mp3", { type: "audio/mpeg" }),
      model: "whisper-1",
      language: locale,
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });
    const words = (res as { words?: { word: string; start: number; end: number }[] }).words ?? [];
    await getDb()
      .insert(aiUsage)
      .values({ kind: "short-transcribe", provider: "openai", model: "whisper-1", inputTokens: 0, outputTokens: 0 })
      .catch(() => undefined);
    return words.length ? words.map((w) => ({ w: w.word, start: w.start, end: w.end })) : null;
  } catch (err) {
    console.warn("[shorts] word timestamps failed, estimating instead", (err as Error).message);
    return null;
  }
}

/**
 * Use the narration's own words (with punctuation) for the captions, and the
 * transcription only for the timing: whisper drops punctuation and may hear words differently.
 */
export function alignWords(narration: string, timed: Word[] | null, seconds: number): Word[] {
  const words = narration.split(/\s+/).filter(Boolean);
  if (timed && timed.length === words.length) {
    return words.map((w, i) => ({ w, start: timed[i].start, end: timed[i].end }));
  }
  if (timed && timed.length > 1) {
    // word counts differ (numbers, contractions): spread our words over the span that was actually spoken
    const from = timed[0].start;
    const to = Math.min(seconds, timed[timed.length - 1].end);
    return estimateWords(narration, Math.max(0.5, to - from)).map((w) => ({ ...w, start: w.start + from, end: w.end + from }));
  }
  return estimateWords(narration, seconds);
}

async function makeVoice(shortId: number, index: number, narration: string, locale: Locale) {
  const key = `audio-short-${shortId}-${index}-${randomBytes(4).toString("hex")}`;
  let mp3: Uint8Array;
  const cfg = speechConfig(locale);
  if (cfg.mock) {
    mp3 = silentMp3(Math.max(2, narration.split(/\s+/).length / 2.6));
  } else {
    mp3 = await ttsChunk(narration, locale, cfg.model, cfg.voice);
  }
  const { frames, seconds } = mp3Frames(mp3);
  if (!frames.length || seconds <= 0) throw new AiError(`De stem voor scène ${index + 1} is mislukt. Probeer het opnieuw.`);
  await writeFile(path.join(uploadsDir(), `${key}.mp3`), mp3);
  const words = alignWords(narration, cfg.mock ? null : await transcribeWords(mp3, locale), seconds);
  if (!cfg.mock) {
    await getDb()
      .insert(aiUsage)
      .values({ kind: "short-voice", provider: "openai", model: cfg.model, inputTokens: Math.ceil(narration.length / 4), outputTokens: Math.round((seconds / 60) * 1250) })
      .catch(() => undefined);
  }
  return { key, seconds: Math.round(seconds * 1000) / 1000, words };
}

export interface GenerateOptions {
  /** only this scene (0-based); otherwise every scene that is missing or outdated */
  scene?: number;
  /** what to (re)make; "all" = image and voice */
  part?: "image" | "voice" | "all";
  /** remake even when it's up to date (the "new illustration" button) */
  force?: boolean;
}

/** make the missing or outdated illustrations and voices */
export async function generateShortAssets(id: number, opts: GenerateOptions = {}): Promise<Short> {
  const short = await claim(id);
  const { storyboard, locale } = short;
  const assets: ShortAssets = alignAssets(storyboard, short.assets);
  const part = opts.part ?? "all";
  try {
    const jobs: { index: number; kind: "image" | "voice" }[] = [];
    storyboard.scenes.forEach((scene, index) => {
      if (opts.scene !== undefined && opts.scene !== index) return;
      const st = sceneStatus(scene, assets.scenes[index]);
      if ((part === "all" || part === "image") && (opts.force || !st.imageReady)) jobs.push({ index, kind: "image" });
      if ((part === "all" || part === "voice") && (opts.force || !st.voiceReady)) jobs.push({ index, kind: "voice" });
    });

    const old: SceneAssets[] = [];
    let failure: unknown = null;
    await mapLimit(jobs, PARALLEL, async ({ index, kind }) => {
      if (failure) return;
      const scene = storyboard.scenes[index];
      const current = assets.scenes[index] ?? emptySceneAssets();
      try {
        if (kind === "image") {
          const key = await makeImage(id, index, scene.imagePrompt, storyboard.character);
          old.push({ ...emptySceneAssets(), imageKey: current.imageKey });
          assets.scenes[index] = { ...assets.scenes[index], imageKey: key, imagePrompt: scene.imagePrompt };
        } else {
          const v = await makeVoice(id, index, scene.narration, locale);
          old.push({ ...emptySceneAssets(), audioKey: current.audioKey });
          assets.scenes[index] = { ...assets.scenes[index], audioKey: v.key, narration: scene.narration, seconds: v.seconds, words: v.words };
        }
      } catch (err) {
        failure ??= err;
      }
    });
    // keep everything that did succeed, even when one job failed
    await release(id, { assets, error: failure ? (failure as Error).message : null });
    await deleteSceneFiles(old);
    if (failure) throw failure;
  } catch (err) {
    await release(id);
    throw err;
  }
  return (await getShort(id))!;
}

/** cost hint shown before generating (dollars, rough) */
export function shortCostHint(sceneCount: number): string {
  if (isMock()) return "gratis (testmodus)";
  const low = 0.04 * sceneCount + 0.03;
  const high = 0.1 * sceneCount + 0.05;
  return `± $${low.toFixed(2)}–${high.toFixed(2)}`;
}

export function shortsMockMode(): boolean {
  return isMock();
}

