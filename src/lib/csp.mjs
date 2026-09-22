// Content-Security-Policy shared by the site and the blog (Astro
// `security.csp`), emitted as a <meta> tag on every page. Astro hashes the
// scripts it bundles; Base.astro adds the hash of its one inline script.
// frame-ancestors can't go in a meta tag; set it as a response header.
// Cloudflare injects same-origin /cdn-cgi/ scripts and its Web Analytics
// beacon, hence 'self' and static.cloudflareinsights.com.
export const csp = {
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
  // Components set CSS variables, and Shiki sets colors, through style="".
  styleDirective: {
    resources: ["'self'", "'unsafe-inline'"],
  },
};
