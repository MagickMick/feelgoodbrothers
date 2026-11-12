import type { APIRoute } from "astro";
import { serveMediaFile } from "@fgb/core/storage";

// image previews in the admin (nginx serves these in production)
export const GET: APIRoute = ({ params }) => serveMediaFile(params.file ?? "");
