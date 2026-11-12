import type { APIRoute } from "astro";
import { createTranslationDraft, ValidationError } from "@fgb/core/admin";

export const POST: APIRoute = async ({ params, redirect }) => {
  try {
    const newId = await createTranslationDraft(Number(params.id));
    return redirect(`/posts/${newId}/`);
  } catch (err) {
    if (err instanceof ValidationError) return redirect("/");
    throw err;
  }
};
