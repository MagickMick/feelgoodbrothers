import type { APIRoute } from "astro";
import { runTurn } from "@fgb/core/ai";
import { AiError, availableProviders, PROVIDER_LABELS, type AiProviderName } from "@fgb/core/ai/provider";

/** marker the client looks for when something fails mid-stream */
const ERROR_MARKER = "\u0000AI_ERROR:";

/** stream one AI turn as plain text (first turn = generate, later turns = apply feedback) */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const sessionId = Number(body?.sessionId);
  if (!sessionId) return Response.json({ error: "Ongeldige sessie" }, { status: 400 });
  // an explicitly chosen provider must be available: never silently switch to another (paid) one
  if (body?.provider && !availableProviders().includes(body.provider)) {
    const label = PROVIDER_LABELS[body.provider as AiProviderName] ?? String(body.provider);
    return Response.json({ error: `${label} is niet beschikbaar. Kies een andere AI.` }, { status: 400 });
  }
  const provider = body?.provider as AiProviderName | undefined;

  let turn: Awaited<ReturnType<typeof runTurn>>;
  try {
    turn = await runTurn(sessionId, typeof body?.feedback === "string" ? body.feedback : null, provider);
  } catch (err) {
    if (err instanceof AiError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of turn.text) controller.enqueue(encoder.encode(chunk));
        await turn.done;
      } catch (err) {
        const msg = err instanceof AiError ? err.message : "Er ging iets mis bij de AI.";
        if (!(err instanceof AiError)) console.error("[ai] turn failed", err);
        controller.enqueue(encoder.encode(`${ERROR_MARKER}${msg}`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no", // tell nginx not to buffer
    },
  });
};
