import type { PostInput } from "@fgb/core/admin";
import { localInputToDate, dateToLocalInput } from "@fgb/core/time";
import { mediaUrl } from "@fgb/core/storage";
import type { PostWithRelations } from "@fgb/core/posts";
import type { Locale } from "@fgb/core/schema";
import type { EditorPost } from "@/components/PostEditor";
import { num, str } from "./ui";

export function parsePostForm(form: FormData): PostInput {
  const action = str(form, "action");
  return {
    locale: (str(form, "locale") === "nl" ? "nl" : "en") as Locale,
    title: str(form, "title"),
    slug: str(form, "slug"),
    description: str(form, "description"),
    body: str(form, "body").replace(/\r\n/g, "\n"),
    heroId: num(form, "heroId"),
    heroAlt: str(form, "heroAlt"),
    authorId: num(form, "authorId"),
    kind: str(form, "kind") === "guest" ? "guest" : "team",
    guestName: str(form, "guestName"),
    guestEmail: str(form, "guestEmail"),
    // a date without time: store noon Amsterdam time so it never shifts a day
    guestConsentAt: localInputToDate(str(form, "guestConsentDate") ? `${str(form, "guestConsentDate")}T12:00` : ""),
    guestNote: str(form, "guestNote"),
    categoryIds: form.getAll("categoryIds").map(Number).filter((n) => n > 0),
    action: action === "publish" || action === "schedule" ? action : "draft",
    publishAt: localInputToDate(str(form, "publishAt")),
    seoTitle: str(form, "seoTitle"),
    metaDescription: str(form, "metaDescription"),
    canonicalUrl: str(form, "canonicalUrl"),
    noindex: form.get("noindex") === "on",
    translationGroup: str(form, "translationGroup") || undefined,
  };
}

export function toEditorPost(p: PostWithRelations): EditorPost {
  return {
    id: p.id,
    locale: p.locale,
    title: p.title,
    slug: p.slug,
    description: p.description,
    body: p.body,
    heroId: p.heroId,
    heroUrl: p.hero ? mediaUrl(p.hero, 800) : null,
    heroAlt: p.heroAlt,
    authorId: p.authorId,
    kind: p.kind,
    guestName: p.guestName ?? "",
    guestEmail: p.guestEmail ?? "",
    guestConsentDate: dateToLocalInput(p.guestConsentAt).slice(0, 10),
    guestNote: p.guestNote ?? "",
    categoryIds: p.categories.map((c) => c.id),
    status: p.status,
    publishAtLocal: dateToLocalInput(p.publishAt),
    isLive: p.status !== "draft" && !!p.publishAt && p.publishAt <= new Date(),
    seoTitle: p.seoTitle ?? "",
    metaDescription: p.metaDescription ?? "",
    canonicalUrl: p.canonicalUrl ?? "",
    noindex: p.noindex,
    translationGroup: p.translationGroup,
  };
}

/** re-fill the editor with what the user submitted (after a validation error) */
export function inputToEditorPost(
  input: PostInput,
  base: Partial<EditorPost>,
  heroUrl: string | null,
  rawPublishAt: string,
): EditorPost {
  return {
    ...base,
    locale: input.locale,
    title: input.title,
    slug: input.slug,
    description: input.description,
    body: input.body,
    heroId: input.heroId,
    heroUrl,
    heroAlt: input.heroAlt,
    authorId: input.authorId,
    kind: input.kind,
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    guestConsentDate: input.guestConsentAt ? dateToLocalInput(input.guestConsentAt).slice(0, 10) : "",
    guestNote: input.guestNote,
    categoryIds: input.categoryIds,
    status: base.status ?? "draft",
    publishAtLocal: rawPublishAt,
    isLive: base.isLive ?? false,
    seoTitle: input.seoTitle,
    metaDescription: input.metaDescription,
    canonicalUrl: input.canonicalUrl,
    noindex: input.noindex,
    translationGroup: input.translationGroup,
  };
}
