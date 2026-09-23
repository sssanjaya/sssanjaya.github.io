// @ts-check
// The blog: a second Astro project in this repo, served at
// blog.sanjayhona.com.np from Cloudflare Pages (.github/workflows/blog.yml).
// It reuses the site's layout, components, and styles from ../src.
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { readFileSync, readdirSync } from "node:fs";
import { csp } from "../src/lib/csp.mjs";

// Last-modified date per post URL for the sitemap: `updated` if set, else
// `date`, read from each post's frontmatter.
const postsDir = new URL("./src/content/posts/", import.meta.url);
const lastmod = Object.fromEntries(
  readdirSync(postsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const fm = readFileSync(new URL(f, postsDir), "utf8").split("---")[1] ?? "";
      const pick = (k) => fm.match(new RegExp(`^${k}:\\s*['"]?([^'"\\n]+)`, "m"))?.[1];
      return [`https://blog.sanjayhona.com.np/${f.replace(/\.md$/, "")}/`, pick("updated") ?? pick("date")];
    }),
);

export default defineConfig({
  site: "https://blog.sanjayhona.com.np",
  // Prism highlights with CSS classes (colors live in styles/prose.css),
  // so code blocks follow the site palette in both themes.
  markdown: { syntaxHighlight: "prism" },
  security: { csp },
  integrations: [
    sitemap({
      serialize(item) {
        const d = lastmod[item.url];
        return d ? { ...item, lastmod: new Date(d).toISOString() } : item;
      },
    }),
  ],
  // Let the dev server read the shared files in ../src.
  vite: { server: { fs: { allow: [".."] } } },
});
