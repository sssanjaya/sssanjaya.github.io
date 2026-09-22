// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { csp } from "./src/lib/csp.mjs";

// https://astro.build/config
export default defineConfig({
  site: "https://sanjayhona.com.np",
  // Custom domain serves at root, so no `base`.
  // Default output is fully static — exactly what GitHub Pages serves.
  // No Markdown on this site; turning Shiki off also drops its CSP warning.
  markdown: { syntaxHighlight: false },
  // Shared with the blog; see src/lib/csp.mjs.
  security: { csp },
  integrations: [
    sitemap({
      // Single-author site: home weighted highest, case studies below it.
      changefreq: "monthly",
      serialize(item) {
        item.priority = item.url === "https://sanjayhona.com.np/" ? 1.0 : 0.7;
        return item;
      },
    }),
  ],
});
