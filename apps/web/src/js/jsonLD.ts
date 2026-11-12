/**
 * schema.org JSON-LD builders. Each returns a plain object; BaseHead serializes them.
 */
import { absoluteUrl, SITE_URL } from "@fgb/core/posts";

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: "Feelgood Brothers",
    url: `${SITE_URL}/`,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/images/logo-512.png`,
      width: 512,
      height: 512,
    },
    email: "info@feelgoodbrothers.com",
  };
}

export function websiteLd(locale: "en" | "nl", description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": SITE_ID,
    name: "Feelgood Brothers",
    url: `${SITE_URL}/`,
    description,
    inLanguage: locale === "nl" ? "nl-NL" : "en-US",
    publisher: { "@id": ORG_ID },
  };
}

export interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbLd(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  };
}

export interface BlogPostingInput {
  url: string;
  title: string;
  description: string;
  locale: "en" | "nl";
  images: string[];
  datePublished: Date;
  dateModified?: Date | null;
  author?: { name: string; url?: string } | null;
  categories: string[];
  wordCount: number;
}

export function blogPostingLd(p: BlogPostingInput) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(p.url) },
    url: absoluteUrl(p.url),
    headline: p.title.slice(0, 110),
    description: p.description,
    inLanguage: p.locale === "nl" ? "nl-NL" : "en-US",
    image: p.images.map(absoluteUrl),
    datePublished: p.datePublished.toISOString(),
    dateModified: (p.dateModified ?? p.datePublished).toISOString(),
    author: p.author
      ? { "@type": "Person", name: p.author.name, ...(p.author.url ? { url: absoluteUrl(p.author.url) } : {}) }
      : { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    isPartOf: { "@id": SITE_ID },
    articleSection: p.categories,
    keywords: p.categories.join(", "),
    wordCount: p.wordCount,
  };
}

export function personLd(p: { name: string; url: string; description: string; image?: string; sameAs?: string[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: {
      "@type": "Person",
      name: p.name,
      url: absoluteUrl(p.url),
      description: p.description,
      image: p.image ? absoluteUrl(p.image) : undefined,
      sameAs: p.sameAs?.length ? p.sameAs : undefined,
    },
  };
}
