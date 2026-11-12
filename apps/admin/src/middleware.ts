import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, validateSession } from "@fgb/core/auth";

const PUBLIC_PATHS = ["/login", "/health"];

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, cookies, locals } = context;
  locals.user = null;

  const isPublic = PUBLIC_PATHS.some((p) => url.pathname === p || url.pathname === `${p}/`);
  // uploaded images are needed on the login page too (none there), but keep them behind auth
  if (!isPublic) {
    locals.user = await validateSession(cookies.get(SESSION_COOKIE)?.value);
    if (!locals.user) {
      if (url.pathname.startsWith("/api/")) {
        return new Response(JSON.stringify({ error: "Niet ingelogd" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      const next = url.pathname === "/" ? "" : `?next=${encodeURIComponent(url.pathname + url.search)}`;
      return context.redirect(`/login${next}`);
    }
  }

  const response = await next();
  // the admin must never end up in search engines or caches
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
});
