/**
 * Read-aloud version of a blog post (text to speech).
 *
 * Made on request from the editor, never automatically. The post text is split
 * into chunks (the TTS model takes about 2000 tokens per request), each chunk is
 * turned into MP3 by OpenAI, and the MP3 frames are joined into one file in the
 * uploads folder (/media/audio-<key>.mp3, immutable like the images).
 * With AI_PROVIDER=mock or without an OpenAI key, a silent MP3 is written instead,
 * so the whole flow can be tested for free.
 */
import { createHash, randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../db.ts";
import { aiUsage, posts, type Locale } from "../schema.ts";
import { uploadsDir } from "../storage.ts";
import { postPath } from "../posts.ts";
import { purgeCloudflare } from "../notify.ts";
import { countPlaceholders } from "./prompts.ts";
import { AiError } from "./provider.ts";

const CHUNK_CHARS = 1500;
const PARALLEL = 3;
/** a generation older than this is treated as crashed */
const BUSY_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
export function speechConfig(locale: Locale) {
  const useMock = process.env.AI_PROVIDER === "mock" || !process.env.OPENAI_API_KEY;
  return {
    mock: useMock,
    model: useMock ? "mock" : process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    voice:
      (locale === "nl" ? process.env.OPENAI_TTS_VOICE_NL : process.env.OPENAI_TTS_VOICE_EN) ||
      process.env.OPENAI_TTS_VOICE ||
      "cedar",
  };
}

const INSTRUCTIONS: Record<Locale, string> = {
  en: "You are reading a personal, first-person blog story about mental health out loud. Speak calmly, warmly and naturally, like someone telling their own story to a friend, not like a news anchor or an advert. American English. Pause briefly after headings.",
  nl: "Je leest een persoonlijk blogverhaal over mentale gezondheid voor, in de ik-vorm. Spreek rustig, warm en natuurlijk, als iemand die zijn eigen verhaal aan een vriend vertelt, niet als een nieuwslezer of reclame. Natuurlijk Nederlands met een Nederlandse uitspraak. Neem een korte pauze na tussenkoppen.",
};

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------
function inline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> their text
    .replace(/<[^>]+>/g, " ") // html / components
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(\S(?:.*?\S)?)\1/g, "$2") // emphasis
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** the text that is read aloud: title, then the body as plain paragraphs */
export function speechText(post: { title: string; body: string }): string {
  const body = post.body.replace(/\r\n/g, "\n").replace(/```[\s\S]*?```/g, "\n");
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const p = current.join(" ").replace(/\s+/g, " ").trim();
    if (p) paragraphs.push(p);
    current = [];
  };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line) || /^(import|export)\s/.test(line)) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const h = inline(heading[1]).replace(/[.:!?]*$/, "");
      if (h) paragraphs.push(`${h}.`);
      continue;
    }
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const t = inline(item[1]);
      if (t) paragraphs.push(/[.!?…]$/.test(t) ? t : `${t}.`);
      continue;
    }
    current.push(inline(line.replace(/^>\s?/, "")));
  }
  flush();
  const title = inline(post.title).replace(/[.:!?]*$/, "");
  return [title ? `${title}.` : "", ...paragraphs].filter(Boolean).join("\n\n");
}

export function speechTextHash(post: { title: string; body: string }): string {
  return createHash("sha256").update(speechText(post)).digest("hex");
}

/** split into chunks of at most `max` characters, on paragraph or sentence boundaries */
export function splitForTts(text: string, max = CHUNK_CHARS): string[] {
  const pieces: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    if (para.length <= max) {
      pieces.push(para);
      continue;
    }
    // long paragraph: split into sentences, and hard-split a sentence that is still too long
    for (const sentence of para.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)\s*/g) ?? [para]) {
      let s = sentence.trim();
      while (s.length > max) {
        const cut = s.lastIndexOf(" ", max);
        const at = cut > max / 2 ? cut : max;
        pieces.push(s.slice(0, at).trim());
        s = s.slice(at).trim();
      }
      if (s) pieces.push(s);
    }
  }
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const next = current ? `${current}\n\n${piece}` : piece;
    if (next.length > max && current) {
      chunks.push(current);
      current = piece;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** rough minutes of audio for a text (~150 spoken words per minute) */
export function estimateMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 150));
}

// ---------------------------------------------------------------------------
// mp3
// ---------------------------------------------------------------------------
const BITRATES: Record<string, number[]> = {
  // [version 1, layer 3] and [version 2/2.5, layer 3], kbps by index
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * Walk the MPEG layer III frames of an MP3 buffer. Returns the audio frames only
 * (ID3 tags and the Xing/Info header frame are dropped, so joined files report the
 * right length) and the total duration in seconds.
 */
export function mp3Frames(buf: Uint8Array): { frames: Uint8Array[]; seconds: number } {
  const frames: Uint8Array[] = [];
  let seconds = 0;
  let i = 0;
  // ID3v2 tag at the start
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    i = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  }
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const version = (buf[i + 1] >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[i + 1] >> 1) & 0x03; // 1 = layer III
    const bitrateIdx = (buf[i + 2] >> 4) & 0x0f;
    const rateIdx = (buf[i + 2] >> 2) & 0x03;
    const padding = (buf[i + 2] >> 1) & 0x01;
    const mono = ((buf[i + 3] >> 6) & 0x03) === 3;
    if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) {
      i++;
      continue;
    }
    const kbps = (version === 3 ? BITRATES.v1 : BITRATES.v2)[bitrateIdx];
    const sampleRate = SAMPLE_RATES[version][rateIdx];
    const samples = version === 3 ? 1152 : 576;
    const length = Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding;
    if (i + length > buf.length) break;
    const frame = buf.subarray(i, i + length);
    // Xing/Info/VBRI header frame: metadata only, describes this chunk alone
    const sideInfo = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const tag = String.fromCharCode(...frame.subarray(4 + sideInfo, 8 + sideInfo));
    const vbri = String.fromCharCode(...frame.subarray(36, 40));
    if (tag !== "Xing" && tag !== "Info" && vbri !== "VBRI") {
      frames.push(frame);
      seconds += samples / sampleRate;
    }
    i += length;
  }
  return { frames, seconds };
}

/** silent MP3 (MPEG1 layer III, 128 kbps, 44.1 kHz, mono) of about `seconds` long */
export function silentMp3(seconds: number): Uint8Array {
  const frameLength = 417; // 144 * 128000 / 44100
  const count = Math.max(1, Math.round((seconds * 44100) / 1152));
  const out = new Uint8Array(frameLength * count);
  for (let f = 0; f < count; f++) out.set([0xff, 0xfb, 0x90, 0xc4], f * frameLength);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------
async function ttsChunk(text: string, locale: Locale, model: string, voice: string): Promise<Uint8Array> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  try {
    const res = await client.audio.speech.create({
      model,
      voice,
      input: text,
      instructions: INSTRUCTIONS[locale],
      response_format: "mp3",
    });
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof OpenAI.AuthenticationError) throw new AiError("OpenAI: de API-key is ongeldig.");
    if (err instanceof OpenAI.RateLimitError) throw new AiError("OpenAI: limiet bereikt of tegoed op. Probeer het later opnieuw.");
    if (err instanceof OpenAI.NotFoundError) throw new AiError(`OpenAI: het spraakmodel "${model}" bestaat niet (meer). Pas OPENAI_TTS_MODEL aan.`);
    if (err instanceof OpenAI.APIError) throw new AiError(`OpenAI-fout (${err.status ?? "?"}): ${err.message}`);
    throw new AiError("Kon OpenAI niet bereiken.");
  }
}

/** run `fn` over items with at most `limit` at the same time, keeping the order */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed && next < items.length) {
        const i = next++;
        try {
          results[i] = await fn(items[i]);
        } catch (err) {
          if (!failed) {
            failed = true;
            failure = err;
          }
        }
      }
    }),
  );
  if (failed) throw failure;
  return results;
}

function audioFile(key: string): string {
  return path.join(uploadsDir(), `${key}.mp3`);
}

export function audioUrl(key: string): string {
  return `/media/${key}.mp3`;
}

export async function deleteAudioFile(key: string | null | undefined): Promise<void> {
  if (key && /^audio-[a-z0-9-]+$/.test(key)) await unlink(audioFile(key)).catch(() => undefined);
}

function isLive(status: string, publishAt: Date | null): boolean {
  return status !== "draft" && !!publishAt && publishAt <= new Date();
}

/** make (or remake) the read-aloud version of a saved post */
export async function generatePostAudio(postId: number): Promise<{ key: string; seconds: number }> {
  const db = getDb();
  // claim the post: one generation at a time (a double click must not pay twice)
  const [post] = await db
    .update(posts)
    .set({ audioBusySince: new Date() })
    .where(and(eq(posts.id, postId), or(isNull(posts.audioBusySince), lt(posts.audioBusySince, new Date(Date.now() - BUSY_MS)))))
    .returning();
  if (!post) {
    const [exists] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId));
    throw new AiError(exists ? "Er wordt al een voorlezing gemaakt voor deze blog. Wacht even." : "Post niet gevonden");
  }
  const release = () => db.update(posts).set({ audioBusySince: null }).where(eq(posts.id, postId));

  try {
    if (countPlaceholders(`${post.title}\n${post.body}`) > 0) {
      throw new AiError("Er staan nog invulpunten [[…]] in de tekst. Vul die eerst in.");
    }
    const text = speechText(post);
    if (text.split(/\s+/).length < 20) throw new AiError("Er is te weinig tekst om voor te lezen.");

    const { mock, model, voice } = speechConfig(post.locale);
    const chunks = splitForTts(text);
    const parts = mock
      ? [silentMp3(Math.min(20, estimateMinutes(text) * 2))]
      : await mapLimit(chunks, PARALLEL, (c) => ttsChunk(c, post.locale, model, voice));
    const parsed = parts.map(mp3Frames);
    const seconds = Math.round(parsed.reduce((n, p) => n + p.seconds, 0));
    const data = concat(parsed.flatMap((p) => p.frames));
    if (data.length === 0 || seconds === 0) throw new AiError("De voorlezing is mislukt (leeg geluidsbestand). Probeer het opnieuw.");

    const key = `audio-${post.id}-${randomBytes(4).toString("hex")}`;
    await writeFile(audioFile(key), data);
    await db
      .update(posts)
      .set({
        audioKey: key,
        audioDurationSec: seconds,
        audioVoice: mock ? "mock" : voice,
        audioTextHash: speechTextHash(post),
        audioCreatedAt: new Date(),
        audioBusySince: null,
      })
      .where(eq(posts.id, postId));
    await deleteAudioFile(post.audioKey);

    // the TTS endpoint reports no token usage: store an estimate (text ~4 chars per token,
    // audio ~1250 output tokens per minute), clearly marked by kind "speech"
    await db
      .insert(aiUsage)
      .values({
        kind: "speech",
        provider: mock ? "mock" : "openai",
        model,
        inputTokens: Math.ceil(text.length / 4),
        outputTokens: Math.round((seconds / 60) * 1250),
        postId,
      })
      .catch((err) => console.error("[speech] could not record usage", err));

    if (isLive(post.status, post.publishAt)) void purgeCloudflare([postPath(post.locale, post.slug)]);
    return { key, seconds };
  } catch (err) {
    await release();
    throw err;
  }
}

export async function removePostAudio(postId: number): Promise<void> {
  const db = getDb();
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post) return;
  if (post.audioBusySince && post.audioBusySince.getTime() > Date.now() - BUSY_MS) {
    throw new AiError("Er wordt nu een voorlezing gemaakt. Wacht tot die klaar is.");
  }
  await db
    .update(posts)
    .set({ audioKey: null, audioDurationSec: null, audioVoice: null, audioTextHash: null, audioCreatedAt: null })
    .where(eq(posts.id, postId));
  await deleteAudioFile(post.audioKey);
  if (isLive(post.status, post.publishAt)) void purgeCloudflare([postPath(post.locale, post.slug)]);
}
