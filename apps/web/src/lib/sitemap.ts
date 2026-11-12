/**
 * Dynamic XML sitemaps from the database (with hreflang alternates).
 * /sitemap.xml is an index pointing to /sitemap-en.xml and /sitemap-nl.xml.
 */
import {
  absoluteUrl,
  authorPath,
  categoryPath,
  getAllCategories,
  getAuthorsWithLivePosts,
  getCategoriesWithCounts,
  getSitemapPosts,
  postPath,
  SITE_URL,
  type Locale,
} from "@js/blogUtils";

interface UrlEntry {
  loc: string;
  lastmod?: Date | null;
  alternates?: Partial<Record<Locale, string>>;
}

// static pages that exist in both languages
const STATIC_PAGES: Record<Locale, string>[] = [
  { en: "/", nl: "/nl/" },
  { en: "/blog/", nl: "/nl/blog/" },
  { en: "/about/", nl: "/nl/over-ons/" },
  { en: "/categories/", nl: "/nl/categorieen/" },
  { en: "/contact/", nl: "/nl/contact/" },
  { en: "/privacy-policy/", nl: "/nl/privacy-policy/" },
  { en: "/terms/", nl: "/nl/terms/" },
];

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;").replace(/"/g, "&quot;");

function renderUrl(e: UrlEntry): string {
  const alts = e.alternates
    ? Object.entries(e.alternates)
        .filter(([, href]) => href)
        .map(([lang, href]) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${xmlEscape(absoluteUrl(href!))}"/>`)
    : [];
  if (alts.length > 1 && e.alternates?.en) {
    alts.push(`<xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(absoluteUrl(e.alternates.en))}"/>`);
  }
  return [
    "<url>",
    `<loc>${xmlEscape(absoluteUrl(e.loc))}</loc>`,
    e.lastmod ? `<lastmod>${e.lastmod.toISOString()}</lastmod>` : "",
    ...(alts.length > 1 ? alts : []),
    "</url>",
  ].join("");
}

function xmlResponse(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}

export async function sitemapIndexResponse(): Promise<Response> {
  const posts = await getSitemapPosts();
  const last = (l: Locale) => posts.find((p) => p.locale === l)?.lastmod;
  const entries = (["en", "nl"] as Locale[]).map((l) => {
    const lm = last(l);
    return `<sitemap><loc>${SITE_URL}/sitemap-${l}.xml</loc>${lm ? `<lastmod>${lm.toISOString()}</lastmod>` : ""}</sitemap>`;
  });
  return xmlResponse(
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</sitemapindex>`,
  );
}

export async function sitemapResponse(locale: Locale): Promise<Response> {
  const [posts, allCategories, liveCatsEn, liveCatsNl, authorsHere, authorsOther] = await Promise.all([
    getSitemapPosts(),
    getAllCategories(),
    getCategoriesWithCounts("en"),
    getCategoriesWithCounts("nl"),
    getAuthorsWithLivePosts(locale),
    getAuthorsWithLivePosts(locale === "en" ? "nl" : "en"),
  ]);
  const other: Locale = locale === "en" ? "nl" : "en";
  const entries: UrlEntry[] = [];
  const newest = posts.find((p) => p.locale === locale)?.lastmod;

  for (const page of STATIC_PAGES) {
    const isListing = page.en === "/" || page.en === "/blog/";
    entries.push({ loc: page[locale], alternates: page, lastmod: isListing ? newest : undefined });
  }

  // posts, grouped by translation for hreflang
  const byGroup = new Map<string, typeof posts>();
  for (const p of posts) byGroup.set(p.translationGroup, [...(byGroup.get(p.translationGroup) ?? []), p]);
  for (const p of posts) {
    if (p.locale !== locale || p.noindex) continue;
    const alternates: Partial<Record<Locale, string>> = {};
    for (const g of byGroup.get(p.translationGroup) ?? []) {
      if (!g.noindex) alternates[g.locale] = postPath(g.locale, g.slug);
    }
    entries.push({ loc: postPath(locale, p.slug), lastmod: p.lastmod, alternates });
  }

  // categories with live posts
  const liveIds = new Set((locale === "en" ? liveCatsEn : liveCatsNl).map((c) => c.id));
  const otherIds = new Set((locale === "en" ? liveCatsNl : liveCatsEn).map((c) => c.id));
  for (const c of allCategories) {
    if (!liveIds.has(c.id)) continue;
    const alternates: Partial<Record<Locale, string>> = { [locale]: categoryPath(locale, c) };
    if (otherIds.has(c.id)) alternates[other] = categoryPath(other, c);
    entries.push({ loc: categoryPath(locale, c), alternates });
  }

  // authors
  const otherSlugs = new Set(authorsOther.map((a) => a.slug));
  for (const a of authorsHere) {
    const alternates: Partial<Record<Locale, string>> = { [locale]: authorPath(locale, a.slug) };
    if (otherSlugs.has(a.slug)) alternates[other] = authorPath(other, a.slug);
    entries.push({ loc: authorPath(locale, a.slug), lastmod: a.lastmod ? new Date(a.lastmod) : undefined, alternates });
  }

  return xmlResponse(
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries
      .map(renderUrl)
      .join("")}</urlset>`,
  );
}
