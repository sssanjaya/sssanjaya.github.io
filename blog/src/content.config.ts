import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// One Markdown file per post in src/content/posts; the filename is the URL.
const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    // Search snippet and social card text.
    description: z.string().max(170),
    // Publish date. A future date schedules the post: it goes live on the
    // first build on or after it (daily at 11:00 UTC). Use 2026-10-01 or a
    // full timestamp like 2026-10-01T13:00:00Z.
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    // 2 to 5 one-sentence answers, shown above the post and used as the
    // JSON-LD abstract. Written so a reader or an AI agent can quote them alone.
    takeaways: z.array(z.string()).min(2).max(5).optional(),
    // Drafts show in `npm run dev:blog` only.
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
