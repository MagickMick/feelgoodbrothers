import type { APIRoute } from "astro";

// IndexNow key verification file: https://www.indexnow.org/documentation
export const GET: APIRoute = ({ params }) => {
  const key = process.env.INDEXNOW_KEY;
  if (!key || params.key !== key) return new Response("Not found", { status: 404 });
  return new Response(key, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
