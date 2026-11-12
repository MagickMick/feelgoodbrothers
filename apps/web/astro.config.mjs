import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import node from "@astrojs/node";
import icon from "astro-icon";

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL ?? "https://feelgoodbrothers.com",
  // everything is rendered on request from Postgres, so new / scheduled posts
  // are live immediately without a rebuild. Responses are cached by nginx/Cloudflare.
  output: "server",
  adapter: node({ mode: "standalone" }),
  trailingSlash: "ignore", // middleware redirects to the trailing-slash version (same URLs as the old site)
  build: { format: "directory" },
  // Astro 7's HTML compression strips whitespace between text and inline elements
  // on the next line ("but <span>human</span>" -> "buthuman"). gzip/brotli make the difference negligible.
  compressHTML: false,
  // i18n configuration must match src/config/siteSettings.json.ts
  i18n: {
    defaultLocale: "en",
    locales: ["en", "nl"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  security: {
    checkOrigin: true,
    // trust X-Forwarded-Proto/Host from nginx for these hosts
    allowedDomains: [
      { hostname: "feelgoodbrothers.com", protocol: "https" },
      { hostname: "new.feelgoodbrothers.com", protocol: "https" },
    ],
  },
  image: {
    // only local images in src/assets go through astro:assets; uploads are pre-optimized by @fgb/core
    responsiveStyles: false,
  },
  vite: {
    ssr: {
      noExternal: ["@fgb/core"],
      external: ["sharp", "@node-rs/argon2", "postgres"],
    },
  },
  integrations: [
    mdx(),
    icon(),
  ],
});
