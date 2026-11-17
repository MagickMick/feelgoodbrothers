/**
 * Image storage on the local filesystem (a Docker volume in production).
 *
 * Every upload is converted once into:
 *   <key>-<width>.webp   for widths in VARIANT_WIDTHS (never upscaled)
 *   <key>-og.jpg         1200x630 crop for Open Graph / X cards
 *
 * Files are immutable (unique key per upload), so they can be cached forever
 * by browsers / Cloudflare. The apps serve /media/* (this module's serveMediaFile);
 * in production nginx caches those responses.
 *
 * All file access goes through this module, so switching to S3/R2 later only
 * means changing this file.
 */
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { slugify } from "./text.ts";

export const VARIANT_WIDTHS = [480, 800, 1200, 1600, 2000] as const;
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function uploadsDir(): string {
  return path.resolve(process.env.UPLOADS_DIR ?? "../../uploads");
}

export interface ProcessedImage {
  key: string;
  width: number;
  height: number;
  variants: number[];
}

export interface MediaLike {
  key: string;
  width: number;
  height: number;
  variants: number[];
}

/** convert an uploaded image buffer into all variants and write them to disk */
export async function processImage(
  input: Buffer,
  originalName = "image",
): Promise<ProcessedImage> {
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("Afbeelding is te groot (max 15 MB)");
  }
  const base = slugify(path.parse(originalName).name).slice(0, 60) || "image";
  const key = `${base}-${randomBytes(4).toString("hex")}`;
  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });

  // .rotate() applies EXIF orientation, so phone photos are upright
  const source = sharp(input, { failOn: "error" }).rotate();
  const meta = await source.metadata();
  if (!meta.width || !meta.height) throw new Error("Onbekend afbeeldingsformaat");

  // after rotate(), width/height may be swapped
  const swapped = (meta.orientation ?? 1) >= 5;
  const width = swapped ? meta.height : meta.width;
  const height = swapped ? meta.width : meta.height;

  let variants: number[] = VARIANT_WIDTHS.filter((w) => w <= width);
  if (variants.length === 0) variants = [width];

  await Promise.all(
    variants.map((w) =>
      source
        .clone()
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(path.join(dir, `${key}-${w}.webp`)),
    ),
  );

  await source
    .clone()
    .resize({ width: OG_WIDTH, height: OG_HEIGHT, fit: "cover", position: "attention" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(path.join(dir, `${key}-og.jpg`));

  return { key, width, height, variants };
}

export async function deleteImageFiles(m: MediaLike): Promise<void> {
  const dir = uploadsDir();
  const files = [...m.variants.map((w) => `${m.key}-${w}.webp`), `${m.key}-og.jpg`];
  await Promise.all(files.map((f) => unlink(path.join(dir, f)).catch(() => undefined)));
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** pick the smallest variant that is >= the wanted width */
export function mediaUrl(m: MediaLike, wantedWidth = 1200): string {
  const sorted = [...m.variants].sort((a, b) => a - b);
  const w = sorted.find((v) => v >= wantedWidth) ?? sorted[sorted.length - 1];
  return `/media/${m.key}-${w}.webp`;
}

export function mediaSrcset(m: MediaLike): string {
  return [...m.variants]
    .sort((a, b) => a - b)
    .map((w) => `/media/${m.key}-${w}.webp ${w}w`)
    .join(", ");
}

export function ogImageUrl(m: MediaLike): string {
  return `/media/${m.key}-og.jpg`;
}

// ---------------------------------------------------------------------------
// serving (fallback route for dev; nginx handles this in production)
// ---------------------------------------------------------------------------
const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
};

/** "bytes=0-99" / "bytes=100-" / "bytes=-500" -> [start, end] inclusive, or null when invalid */
function parseRange(header: string, size: number): [number, number] | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? [start, end] : null;
}

/**
 * returns a Response for /media/<file>, or 404. Guards against path traversal.
 * Audio supports Range requests (Safari/iOS need them to play and seek).
 */
export async function serveMediaFile(fileName: string, rangeHeader?: string | null): Promise<Response> {
  const safe = path.basename(fileName);
  const ext = path.extname(safe).toLowerCase();
  const type = CONTENT_TYPES[ext];
  if (!type || safe !== fileName) return new Response("Not found", { status: 404 });
  if (ext === ".mp3" && !safe.startsWith("audio-")) return new Response("Not found", { status: 404 });
  const full = path.join(uploadsDir(), safe);
  try {
    const info = await stat(full);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    const size = info.size;
    const headers: Record<string, string> = {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    if (ext !== ".mp3") {
      // images are small (a few hundred KB at most)
      return new Response(new Uint8Array(await readFile(full)), { headers });
    }
    // audio can be many MB: stream it, and for a Range request read only that byte interval
    headers["Accept-Ranges"] = "bytes";
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (rangeHeader) {
      const range = parseRange(rangeHeader, size);
      if (!range) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      [start, end] = range;
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    headers["Content-Length"] = String(end - start + 1);
    if (size === 0) return new Response(new Uint8Array(0), { status, headers });
    const body = Readable.toWeb(createReadStream(full, { start, end })) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { status, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
