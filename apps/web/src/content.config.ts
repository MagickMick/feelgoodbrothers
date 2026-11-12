import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Blog posts and authors live in Postgres (see packages/core).
// Only static legal pages remain as files.
const otherPages = defineCollection({
  loader: glob({ pattern: "**/index.{md,mdx}", base: "./src/content/otherPages" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    draft: z.boolean().optional(),
  }),
});

export const collections = { otherPages };
