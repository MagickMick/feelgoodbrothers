/**
 * Markdown -> sanitized HTML for previews in the admin.
 *
 * Text can come from the AI or from pasted guest stories, so it is untrusted:
 * marked keeps raw HTML (e.g. <img onerror=...>), which would run with the
 * editor's privileges. DOMPurify strips scripts, event handlers and
 * javascript: URLs with an allowlist. Browser only: on the server this returns
 * "" (previews are rendered after hydration).
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "s", "del", "code", "pre", "blockquote",
  "ul", "ol", "li", "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tr", "th", "td", "mark",
];
const ALLOWED_ATTR = ["href", "title", "src", "alt", "class"];

export function renderPreview(markdown: string, opts: { highlightPlaceholders?: boolean } = {}): string {
  if (typeof window === "undefined" || !markdown) return "";
  let html = marked.parse(markdown, { async: false }) as string;
  if (opts.highlightPlaceholders) {
    html = html.replace(/\[\[([^\]]*)\]\]/g, '<mark class="rounded bg-amber-100 px-1 text-amber-900">[[$1]]</mark>');
  }
  // sanitize last, so nothing added above can bypass it
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/|#)/i,
  });
}
