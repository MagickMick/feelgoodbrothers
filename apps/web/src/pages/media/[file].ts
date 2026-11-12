import type { APIRoute } from "astro";
import { serveMediaFile } from "@fgb/core/storage";

// Fallback for local dev. In production nginx serves /media/* directly from the uploads volume.
export const GET: APIRoute = ({ params }) => serveMediaFile(params.file ?? "");
