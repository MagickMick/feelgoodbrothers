import { defineMiddleware } from "astro:middleware";
import { findRedirect } from "@fgb/core/posts";

const HTML_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=86400";
const NOT_FOUND_CACHE = "public, max-age=0, s-maxage=60";

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request } = context;
  const isRead = request.method === "GET" || request.method === "HEAD";

  // 1. canonical trailing slash (same URL format as the old static site): /about -> /about/
  const lastSegment = url.pathname.split("/").pop() ?? "";
  if (isRead && !url.pathname.endsWith("/") && !lastSegment.includes(".")) {
    return context.redirect(`${url.pathname}/${url.search}`, 301);
  }

  const response = await next();

  // 2. 301 for changed slugs (only looked up on 404, so no DB hit on normal requests)
  if (isRead && response.status === 404 && !url.pathname.startsWith("/media/")) {
    try {
      const to = await findRedirect(url.pathname);
      if (to) return context.redirect(to, 301);
    } catch (err) {
      console.error("[redirects] lookup failed", err);
    }
  }

  // 3. CDN / nginx cache headers for HTML pages
  const type = response.headers.get("Content-Type") ?? "";
  if (isRead && type.includes("text/html") && !response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", response.status === 200 ? HTML_CACHE : NOT_FOUND_CACHE);
  }
  return response;
});
