import type { APIRoute } from "astro";
import { deletePost } from "@fgb/core/admin";

export const POST: APIRoute = async ({ params, redirect }) => {
  await deletePost(Number(params.id));
  return redirect("/");
};
