import type { APIRoute } from "astro";
import { SITE_URL } from "@fgb/core/posts";

export const GET: APIRoute = () =>
  new Response(
    ["User-agent: *", "Allow: /", "", `Sitemap: ${SITE_URL}/sitemap.xml`, ""].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
  );
