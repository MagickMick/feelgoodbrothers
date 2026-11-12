import type { APIRoute } from "astro";
import { SESSION_COOKIE, deleteSession } from "@fgb/core/auth";

export const POST: APIRoute = async ({ cookies, redirect }) => {
  await deleteSession(cookies.get(SESSION_COOKIE)?.value);
  cookies.delete(SESSION_COOKIE, { path: "/" });
  return redirect("/login");
};
