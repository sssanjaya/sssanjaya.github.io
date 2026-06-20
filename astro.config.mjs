// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: "https://sanjayhona.com.np",
  // Custom domain serves at root, so no `base`.
  // Default output is fully static — exactly what GitHub Pages serves.
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
