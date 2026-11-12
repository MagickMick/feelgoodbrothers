import type { APIRoute } from "astro";
import { sitemapIndexResponse } from "@/lib/sitemap";

export const GET: APIRoute = () => sitemapIndexResponse();
