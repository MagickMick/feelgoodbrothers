import type { APIRoute } from "astro";
import { audioUrl, generatePostAudio, removePostAudio } from "@fgb/core/ai/speech";
import { AiError } from "@fgb/core/ai/provider";

/**
 * Make or delete the read-aloud version of a saved post. Lives under /api/ai/ so
 * nginx gives it the long timeout (a long post takes up to a minute or so).
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const postId = Number(body?.postId);
  if (!postId) return Response.json({ error: "Ongeldige blog" }, { status: 400 });
  try {
    if (body.action === "delete") {
      await removePostAudio(postId);
      return Response.json({ ok: true });
    }
    const { key, seconds } = await generatePostAudio(postId);
    return Response.json({ ok: true, url: audioUrl(key), seconds });
  } catch (err) {
    if (err instanceof AiError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
};
