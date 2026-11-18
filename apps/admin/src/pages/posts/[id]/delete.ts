import type { APIRoute } from "astro";
import { deletePost, ValidationError } from "@fgb/core/admin";

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = Number(params.id);
  try {
    await deletePost(id);
  } catch (err) {
    if (err instanceof ValidationError) return redirect(`/posts/${id}/?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  return redirect("/");
};
