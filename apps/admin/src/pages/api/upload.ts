import type { APIRoute } from "astro";
import { uploadMedia } from "@fgb/core/admin";
import { MAX_UPLOAD_BYTES, mediaUrl } from "@fgb/core/storage";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/heic", "image/heif"];

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Geen bestand ontvangen" }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type)) {
    return Response.json({ error: "Alleen JPG, PNG, WebP, AVIF of HEIC" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Bestand is groter dan 15 MB" }, { status: 400 });
  }
  try {
    const alt = typeof form.get("alt") === "string" ? String(form.get("alt")) : "";
    const m = await uploadMedia(Buffer.from(await file.arrayBuffer()), file.name, alt);
    return Response.json({ id: m.id, key: m.key, url: mediaUrl(m, 1200), width: m.width, height: m.height });
  } catch (err) {
    console.error("[upload]", err);
    return Response.json({ error: "Kon de afbeelding niet verwerken" }, { status: 400 });
  }
};
