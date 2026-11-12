import type { APIRoute } from "astro";
import { asc } from "drizzle-orm";
import { saveSessionAsDraft } from "@fgb/core/ai";
import { AiError } from "@fgb/core/ai/provider";
import { ValidationError } from "@fgb/core/admin";
import { getDb } from "@fgb/core/db";
import { authors } from "@fgb/core/schema";

/** save the latest draft of a session as a post draft */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const sessionId = Number(body?.sessionId);
  if (!sessionId) return Response.json({ error: "Ongeldige sessie" }, { status: 400 });
  // default author: the first team author (can be changed in the editor)
  const [author] = await getDb().select({ id: authors.id }).from(authors).orderBy(asc(authors.id)).limit(1);
  try {
    const postId = await saveSessionAsDraft(sessionId, author?.id ?? null);
    return Response.json({ postId });
  } catch (err) {
    if (err instanceof AiError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof ValidationError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
};
