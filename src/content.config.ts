import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Project case studies → rendered at /projects/[id].
// Add a markdown file under src/content/projects/ to add a project.
const projects = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    kind: z.string(), // e.g. "EDGE / IOT · PRODUCTION"
    tags: z.array(z.string()),
    status: z.enum(["live", "wip", "archived"]).default("live"),
    order: z.number().default(0), // lower = earlier in the grid
    links: z
      .array(z.object({ label: z.string(), href: z.string() }))
      .default([]),
  }),
});

export const collections = { projects };
