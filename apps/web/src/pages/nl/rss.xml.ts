import type { APIRoute } from "astro";
import { rssResponse } from "@/lib/rss";

export const GET: APIRoute = () => rssResponse("nl");
