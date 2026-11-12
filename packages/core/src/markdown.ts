import { Marked, type Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import { slugify } from "./text.ts";

const SITE_HOSTS = ["feelgoodbrothers.com", "www.feelgoodbrothers.com"];

function isExternal(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    return !SITE_HOSTS.includes(new URL(href).hostname);
  } catch {
    return false;
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function createMarked() {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      // h2/h3 get an id so they can be linked to (and used for a table of contents)
      heading(this: any, token: Tokens.Heading) {
        const text = this.parser.parseInline(token.tokens);
        const id = slugify(token.text);
        return `<h${token.depth} id="${id}">${text}</h${token.depth}>\n`;
      },
      // external links open in a new tab, like the old ExternalLink component
      link(this: any, token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        const title = token.title ? ` title="${escapeAttr(token.title)}"` : "";
        const ext = isExternal(token.href)
          ? ` target="_blank" rel="noopener noreferrer"`
          : "";
        return `<a href="${escapeAttr(token.href)}"${title}${ext}>${text}</a>`;
      },
      image(token: Tokens.Image) {
        const title = token.title ? ` title="${escapeAttr(token.title)}"` : "";
        return `<img src="${escapeAttr(token.href)}" alt="${escapeAttr(token.text)}"${title} loading="lazy" decoding="async" />`;
      },
    },
  });
  return marked;
}

const marked = createMarked();

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img",
    "h1",
    "h2",
    "h3",
    "h4",
    "figure",
    "figcaption",
    "details",
    "summary",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "loading", "decoding", "width", "height"],
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
    h4: ["id"],
    "*": ["class"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
};

/** markdown -> safe HTML for the public site */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** h2 headings, for a table of contents */
export function extractHeadings(md: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const line of md.split("\n")) {
    const m = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ id: slugify(m[1]), text: m[1].replace(/[*_`]/g, "") });
  }
  return out;
}
