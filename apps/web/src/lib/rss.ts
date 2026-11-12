import rss from "@astrojs/rss";
import { absoluteUrl, bylineName, getLivePosts, postPath, SITE_URL, type Locale } from "@js/blogUtils";
import { ogImageUrl } from "@fgb/core/storage";
import { getTranslatedData } from "@js/translationUtils";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function rssResponse(locale: Locale): Promise<Response> {
  const siteData = getTranslatedData("siteData", locale);
  const posts = await getLivePosts(locale, { limit: 50 });
  const self = locale === "nl" ? `${SITE_URL}/nl/rss.xml` : `${SITE_URL}/rss.xml`;
  const res = await rss({
    title: siteData.title,
    description: siteData.description,
    site: locale === "nl" ? `${SITE_URL}/nl/` : `${SITE_URL}/`,
    xmlns: {
      media: "http://search.yahoo.com/mrss/",
      atom: "http://www.w3.org/2005/Atom",
    },
    customData: `<language>${locale === "nl" ? "nl-nl" : "en-us"}</language><atom:link href="${self}" rel="self" type="application/rss+xml" />`,
    items: posts.map((post) => ({
      title: post.title,
      description: post.description,
      pubDate: post.publishAt ?? post.createdAt,
      link: absoluteUrl(postPath(post.locale, post.slug)),
      // never expose a guest's email: guest stories use the site address
      author: bylineName(post)
        ? `${(post.kind === "team" && post.author?.email) || siteData.author.email} (${bylineName(post)})`
        : undefined,
      categories: post.categories.map((c) => (locale === "nl" ? c.nameNl : c.nameEn)),
      customData: post.hero
        ? `<media:content type="image/jpeg" width="1200" height="630" medium="image" url="${escapeXml(absoluteUrl(ogImageUrl(post.hero)))}" />`
        : undefined,
    })),
  });
  res.headers.set("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=86400");
  return res;
}
