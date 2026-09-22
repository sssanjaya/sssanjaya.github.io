// @ts-check
// The blog: a second Astro project in this repo, served at
// blog.sanjayhona.com.np from Cloudflare Pages (.github/workflows/blog.yml).
// It reuses the site's layout, components, and styles from ../src.
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { csp } from "../src/lib/csp.mjs";

export default defineConfig({
  site: "https://blog.sanjayhona.com.np",
  // Prism highlights with CSS classes (colors live in styles/prose.css),
  // so code blocks follow the site palette in both themes.
  markdown: { syntaxHighlight: "prism" },
  security: { csp },
  integrations: [sitemap()],
  // Let the dev server read the shared files in ../src.
  vite: { server: { fs: { allow: [".."] } } },
});
