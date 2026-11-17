import type { APIRoute } from "astro";
import { serveMediaFile } from "@fgb/core/storage";

// Serves uploaded images. In production nginx caches these responses (filenames are unique).
export const GET: APIRoute = ({ params, request }) => serveMediaFile(params.file ?? "", request.headers.get("range"));
