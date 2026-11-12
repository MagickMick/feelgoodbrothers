import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";

// admin.feelgoodbrothers.com: login-protected CMS for blog posts
export default defineConfig({
  site: process.env.ADMIN_URL ?? "https://admin.feelgoodbrothers.com",
  output: "server",
  adapter: node({ mode: "standalone" }),
  security: {
    // checks Origin on form POSTs (CSRF protection)
    checkOrigin: true,
    // trust X-Forwarded-Proto/Host from nginx for these hosts (needed for checkOrigin behind the proxy)
    allowedDomains: [{ hostname: "admin.feelgoodbrothers.com", protocol: "https" }],
  },
  integrations: [react()],
  vite: {
    ssr: {
      noExternal: ["@fgb/core"],
      external: ["sharp", "@node-rs/argon2", "postgres"],
    },
  },
});
