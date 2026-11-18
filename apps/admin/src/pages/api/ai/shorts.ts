import type { APIRoute } from "astro";
import { createShort, deleteShort, generateShortAssets, getShort, rewriteScript, saveStoryboard } from "@fgb/core/shorts";
import { AiError } from "@fgb/core/ai/provider";

/**
 * Shorts actions. Under /api/ai/ so nginx gives the long timeout: making the
 * illustrations of a whole short takes a minute or two.
 *
 *   { action: "create", postId }                       -> { id }
 *   { action: "script", id }                           -> new script
 *   { action: "storyboard", id, storyboard, sceneMap } -> save edits
 *   { action: "generate", id, scene?, part?, force? }  -> illustrations + voice
 *   { action: "delete", id }
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body?.action) return Response.json({ error: "Ongeldige aanvraag" }, { status: 400 });
  const id = Number(body.id);
  try {
    switch (body.action) {
      case "create": {
        const postId = Number(body.postId);
        if (!postId) return Response.json({ error: "Ongeldige blog" }, { status: 400 });
        return Response.json({ id: await createShort(postId) });
      }
      case "script":
        return Response.json({ short: await rewriteScript(id) });
      case "storyboard":
        return Response.json({ short: await saveStoryboard(id, body.storyboard, body.sceneMap) });
      case "generate": {
        const scene = Number.isInteger(body.scene) ? Number(body.scene) : undefined;
        const part = ["image", "voice", "all"].includes(body.part) ? body.part : "all";
        return Response.json({ short: await generateShortAssets(id, { scene, part, force: body.force === true }) });
      }
      case "delete":
        await deleteShort(id);
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "Onbekende actie" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AiError) {
      // return the latest state too, so the page shows what did succeed
      const short = id ? await getShort(id) : null;
      return Response.json({ error: err.message, short }, { status: 400 });
    }
    throw err;
  }
};
