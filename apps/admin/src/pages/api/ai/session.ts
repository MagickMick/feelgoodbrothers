import type { APIRoute } from "astro";
import { createSession, pickSituation } from "@fgb/core/ai";
import { AiError, availableProviders, defaultProvider, PROVIDER_LABELS, type AiProviderName } from "@fgb/core/ai/provider";
import type { AiSessionParams } from "@fgb/core/schema";

/** start a new writing session; the client then calls /api/ai/turn to generate */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: "Ongeldige aanvraag" }, { status: 400 });
  const locale = body.locale === "nl" ? "nl" : "en";
  // an explicitly chosen provider must be available: never silently switch to another (paid) one
  if (body.provider && !availableProviders().includes(body.provider)) {
    const label = PROVIDER_LABELS[body.provider as AiProviderName] ?? String(body.provider);
    return Response.json({ error: `${label} is niet beschikbaar. Kies een andere AI.` }, { status: 400 });
  }
  const provider: AiProviderName = body.provider ?? defaultProvider();
  const categoryIds: number[] = Array.isArray(body.categoryIds) ? body.categoryIds.map(Number).filter((n: number) => n > 0) : [];
  if (categoryIds.length === 0) return Response.json({ error: "Kies minstens één categorie" }, { status: 400 });

  let situationId: number | null = Number(body.situationId) > 0 ? Number(body.situationId) : null;
  let situationLabel = "";
  const situationText = String(body.situationText ?? "").slice(0, 500);
  if (body.situationId === "random" && !situationText) {
    const picked = await pickSituation(categoryIds);
    situationId = picked?.id ?? null;
    situationLabel = picked ? (locale === "nl" ? picked.labelNl : picked.labelEn) : "";
  }
  const length = ["short", "medium", "long"].includes(body.length) ? body.length : "medium";
  const params: AiSessionParams = {
    categoryIds,
    situationId: situationText ? null : situationId,
    situationText,
    persona: String(body.persona ?? "").slice(0, 300),
    length,
    helps: String(body.helps ?? "").slice(0, 300),
    wishes: String(body.wishes ?? "").slice(0, 1500),
    placeholders: body.placeholders !== false,
  };
  try {
    const session = await createSession(locale, params, provider);
    return Response.json({ sessionId: session.id, situationId: params.situationId, situationLabel });
  } catch (err) {
    if (err instanceof AiError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
};
