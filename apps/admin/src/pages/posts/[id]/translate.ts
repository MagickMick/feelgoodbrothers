import type { APIRoute } from "astro";
import { createTranslationDraft, ValidationError } from "@fgb/core/admin";
import { translatePostWithAi } from "@fgb/core/ai";
import { AiError, availableProviders, defaultProvider, type AiProviderName } from "@fgb/core/ai/provider";

/** create the other-language version: a plain copy, or translated by AI (mode=ai) */
export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = Number(params.id);
  const form = await request.formData().catch(() => null);
  try {
    if (form?.get("mode") === "ai") {
      const wanted = String(form.get("provider") ?? "") as AiProviderName;
      if (wanted && !availableProviders().includes(wanted)) {
        return redirect(`/posts/${id}/?error=${encodeURIComponent("Die AI is niet beschikbaar. Kies een andere.")}`);
      }
      const provider = wanted || defaultProvider();
      const newId = await translatePostWithAi(id, provider);
      return redirect(`/posts/${newId}/?translated=ai`);
    }
    const newId = await createTranslationDraft(id);
    return redirect(`/posts/${newId}/`);
  } catch (err) {
    if (err instanceof AiError) return redirect(`/posts/${id}/?error=${encodeURIComponent(err.message)}`);
    if (err instanceof ValidationError) return redirect("/");
    throw err;
  }
};
