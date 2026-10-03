---
title: "Dark mode with no flash under a hash-based CSP in Astro"
description: "A no-flash theme script in Astro: run it inline in head, allow it by a build-time sha256 hash, and check the CSP meta tag comes before it."
date: 2026-10-04
tags: [astro, csp, javascript, static-sites]
takeaways:
  - "A theme script only prevents a flash if it runs inline in head, before the stylesheets and the body, and sets an attribute the CSS keys off."
  - "Computing the script's sha256 at build time from the same string the layout renders means editing the script can never leave a stale CSP hash."
  - "A CSP delivered in a meta tag does not apply to content that comes before it, so an inline script placed above the tag runs whatever its hash."
  - "In this site's Astro build the CSP meta tag lands after the theme script, so the hash is correct but not what lets the script run on page load."
  - "data-cfasync=\"false\" keeps Cloudflare Rocket Loader from deferring the script, and it does not change the script's hash."
---

A dark-by-default site that offers a light theme has to apply a saved choice before the first paint, or light-theme visitors see a dark frame first. The fix is a few lines of inline JavaScript in `<head>`, allowed by a Content-Security-Policy (CSP) hash that the build computes from the script itself. One catch: a CSP in a `<meta>` tag only covers what comes after it, and in this site's build the tag comes after the script.

This post walks through the script in `src/lib/theme.ts`, how Astro gets its hash, what Cloudflare needed, and the ordering check I ran in Chromium. The CSP setup in general is in [hardening a static site](/hardening-a-static-site/).

## The inline theme bootstrap

The site and this blog share one layout, `src/layouts/Base.astro`, and one bootstrap script. The default is dark. A stored `"light"` opts out:

```ts
export const themeBootstrap = `(function () {
  try {
    if (localStorage.getItem("theme") === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      var tc = document.querySelector("#theme-color");
      if (tc) tc.setAttribute("content", "#f4f5f7");
    }
  } catch (e) {}
})();`;
```

The CSS keys every color off that attribute. `:root` holds the dark tokens with `color-scheme: dark`, and `:root[data-theme="light"]` overrides them with `color-scheme: light`. Nothing reads `prefers-color-scheme`, so the operating system setting does not matter. The only input is the stored value.

The layout renders the script with `is:inline`, which tells Astro to leave it as written instead of bundling it:

```astro
<!-- Theme color tracks resolved theme; updated by the bootstrap script -->
<meta name="theme-color" content="#080b10" id="theme-color" />

<!-- data-cfasync="false": Cloudflare Rocket Loader must not defer this. -->
<script is:inline data-cfasync="false" set:html={themeBootstrap} />
```

Three details make it work:

- **Position.** A classic inline script runs as soon as the parser reaches it. Here that is before the `<link rel="stylesheet">` tags and before `<body>`, so the attribute is set before anything paints.
- **The `theme-color` meta.** It sits above the script, so `document.querySelector("#theme-color")` finds it. The browser UI color switches with the page.
- **`try`/`catch`.** If storage access throws, the page stays on the dark default instead of failing.

The rest of the theme logic is in the bundled module, `src/scripts/console.ts`. The toggle flips the attribute, writes `"light"` or `"dark"` to `localStorage`, and updates the `theme-color` meta and the button's `aria-label`. If the write throws, the comment says the theme "still flips for this page view". The sun and moon icons need no script at all. CSS hides one or the other with `:root[data-theme="light"] .sun { display: none; }`.

## Computing the CSP hash at build time

The site's CSP has no `'unsafe-inline'` for scripts. An inline script has to be listed by hash. Pasting a hash into config breaks the moment someone edits the script, so `src/lib/theme.ts` computes it from the same string:

```ts
import { createHash } from "node:crypto";

export const themeBootstrapHash = `sha256-${createHash("sha256").update(themeBootstrap).digest("base64")}` as const;
```

`Base.astro` hands it to Astro's CSP with [`Astro.csp.insertScriptHash()`](https://docs.astro.build/en/reference/api-reference/#csp):

```ts
// Inline theme bootstrap (src/lib/theme.ts), allowed by the CSP via its hash.
Astro.csp?.insertScriptHash(themeBootstrapHash);
```

The policy itself lives in `src/lib/csp.mjs` and is passed to [`security.csp`](https://docs.astro.build/en/reference/configuration-reference/#securitycsp) in both `astro.config.mjs` files. Astro adds hashes for the scripts it bundles and writes the result as `<meta http-equiv="content-security-policy">` on every page.

To check the hash matches what ships, hash the script text in the built HTML and look for it in the policy:

```bash
npm run build
node -e '
const h = require("fs").readFileSync("dist/index.html", "utf8");
const s = h.match(/<script data-cfasync="false">([^<]*)<\/script>/)[1];
console.log(require("crypto").createHash("sha256").update(s).digest("base64"));
'
```

On the current build that prints `FoHpFjzFNIST57jAvLFoOPIn+OiNAelLh/L1bthKH/A=`, which is the last `sha256-` entry in the page's `script-src`.

## Keeping Rocket Loader away from the script

The site is behind Cloudflare, and [Rocket Loader](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/) defers scripts by rewriting their `type`. That would run the bootstrap after the page paints, which brings the flash back. The commit that added the CSP also added `data-cfasync="false"` "so Rocket Loader no longer defers it (restores no-flash for light-theme visitors)". It is the [per-script opt-out](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/ignore-javascripts/).

A CSP hash covers the script's text, not its attributes, so the opt-out does not change the hash. The other HTML rewrites Cloudflare makes, and what each needs from the policy, are in [Cloudflare Rocket Loader, email obfuscation, and your CSP](/cloudflare-edge-rewrites-csp/).

## Where Astro puts the CSP meta tag

The [CSP spec](https://www.w3.org/TR/CSP3/#meta-element) says policies in a `<meta>` element are not applied to content that precedes them. So the hash only gates the bootstrap if the meta tag comes first. In the built `dist/index.html` it does not. These are the byte offsets of the relevant tags in `<head>`:

| Offset | Tag |
|---|---|
| 2980 | `<meta name="theme-color">` |
| 3116 | `<script data-cfasync="false">` (theme bootstrap) |
| 3434 | `<meta http-equiv="content-security-policy">` |
| 4099 | first `<link rel="stylesheet">` |

The blog's `blog/dist/index.html` has the same order.

I tested what that means in Chromium with [Playwright](https://playwright.dev/docs/api/class-page#page-add-init-script). I served a copy of `dist/`, stored `theme=light`, and loaded four versions of the home page: the build as is, the build with one statement added to the bootstrap so its hash no longer matched, and both of those again with the script moved below the meta tag. The check logged the theme at `DOMContentLoaded` and any `securitypolicyviolation` events:

```js
await page.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (e) =>
    console.log("CSP " + e.violatedDirective));
  document.addEventListener("DOMContentLoaded", () =>
    console.log("theme=" + document.documentElement.getAttribute("data-theme")));
});
```

| Script position | Script text | Result |
|---|---|---|
| Before the meta (as built) | Original | Light theme applied, no violation |
| Before the meta (as built) | Edited, hash stale | Light theme applied, edited code ran, no violation |
| After the meta | Original | Light theme applied, no violation |
| After the meta | Edited, hash stale | Script blocked, page stayed dark |

The blocked case logged the error you get from a stale hash:

```text
Refused to execute inline script because it violates the following Content Security Policy directive: "script-src 'self' https://static.cloudflareinsights.com 'sha256-...'". Either the 'unsafe-inline' keyword, a hash ('sha256-W2unAav2++4qMr6607WzfSfdaFhCSDUiOBDsX084IKY='), or a nonce ('nonce-...') is required to enable inline execution.
```

So on this site the hash is correct, and the no-flash behavior works, but the hash is not what allows the bootstrap to run on page load. The script runs because the browser has no policy yet when it reaches it. If the meta tag moves above the script, the computed hash is already in place and keeps working. That is the case the build-time hash was written for.

## Checking a no-flash theme script

| Check | How |
|---|---|
| Script runs before paint | It is a classic inline `<script>` in `<head>`, above the stylesheets |
| Hash matches the shipped script | Hash the text in `dist/*.html` and find it in `script-src` |
| Policy covers the script | The CSP `<meta>` offset is lower than the script's offset |
| Edge does not defer it | `data-cfasync="false"` on the tag, and the live HTML shows the script with no rewritten `type` |
| Light theme survives reload | Store `theme=light`, reload, read `data-theme` at `DOMContentLoaded` |

The third row is the one this build misses. A normal page load will not show it, because the script runs either way.
