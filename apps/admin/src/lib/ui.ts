import type { PostStatus } from "@fgb/core/schema";

export function statusInfo(status: PostStatus, publishAt: Date | null): { label: string; cls: string } {
  const live = status !== "draft" && publishAt && publishAt <= new Date();
  if (live) return { label: "Live", cls: "bg-green-100 text-green-800" };
  if (status === "draft") return { label: "Concept", cls: "bg-gray-100 text-gray-700" };
  return { label: "Ingepland", cls: "bg-blue-100 text-blue-800" };
}

export const FLAGS: Record<string, string> = { en: "🇺🇸 EN", nl: "🇳🇱 NL" };

export function siteUrl(): string {
  return (process.env.SITE_URL ?? "https://feelgoodbrothers.com").replace(/\/$/, "");
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

export function num(form: FormData, key: string): number | null {
  const n = Number(str(form, key));
  return Number.isFinite(n) && n > 0 ? n : null;
}
