// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: "https://sanjayhona.com.np",
  // Custom domain serves at root, so no `base`.
  // Default output is fully static — exactly what GitHub Pages serves.
  // No Markdown on this site; turning Shiki off also drops its CSP warning.
  markdown: { syntaxHighlight: false },
  // Content-Security-Policy, emitted as a <meta> tag on every page. Astro
  // hashes the scripts it bundles; Base.astro adds the hash of its one inline
  // script. frame-ancestors can't go in a meta tag; set it at the edge.
  // Cloudflare (in front of Pages) injects same-origin /cdn-cgi/ scripts and
  // its Web Analytics beacon, hence 'self' and static.cloudflareinsights.com.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
        "upgrade-insecure-requests",
      ],
      scriptDirective: {
        resources: ["'self'", "https://static.cloudflareinsights.com"],
      },
      // Components set CSS variables through style="" attributes.
      styleDirective: {
        resources: ["'self'", "'unsafe-inline'"],
      },
    },
  },
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
