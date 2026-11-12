/**
 * Side effects after publishing: purge Cloudflare cache and ping IndexNow.
 * Both are optional and only run when the env vars are set. Failures are
 * logged and never block saving a post.
 */
import { absoluteUrl, SITE_URL } from "./posts.ts";

export async function purgeCloudflare(paths: string[]): Promise<void> {
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!zone || !token || paths.length === 0) return;
  const files = [...new Set(paths.map(absoluteUrl))].slice(0, 30);
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    if (!res.ok) console.warn("[cloudflare] purge failed", res.status, await res.text());
  } catch (err) {
    console.warn("[cloudflare] purge error", err);
  }
}

/** IndexNow (Bing, Yandex, Seznam, Naver). Key file is served by the web app at /<key>.txt */
export async function pingIndexNow(paths: string[]): Promise<void> {
  const key = process.env.INDEXNOW_KEY;
  if (!key || paths.length === 0 || process.env.NODE_ENV !== "production") return;
  const host = new URL(SITE_URL).host;
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${SITE_URL}/${key}.txt`,
        urlList: [...new Set(paths.map(absoluteUrl))],
      }),
    });
    if (!res.ok && res.status !== 202) console.warn("[indexnow] ping failed", res.status);
  } catch (err) {
    console.warn("[indexnow] ping error", err);
  }
}

export async function notifyContentChanged(paths: string[]): Promise<void> {
  await Promise.allSettled([purgeCloudflare(paths), pingIndexNow(paths)]);
}
