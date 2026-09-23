---
title: "Cloudflare Rocket Loader, email obfuscation, and your CSP"
description: "Cloudflare rewrites HTML behind its proxy. How Rocket Loader, email obfuscation, and the Web Analytics beacon change the page, and what each needs from a CSP."
date: 2026-09-24
tags: [cloudflare, csp, security, static-sites]
takeaways:
  - "Cloudflare can rewrite HTML on its way to the browser, so audit the page a browser receives, not the files the build writes."
  - "Rocket Loader changes each script's type attribute and runs the scripts itself later; data-cfasync=\"false\" keeps one script out of it."
  - "Email Address Obfuscation swaps mailto links and visible addresses for /cdn-cgi/ URLs plus a same-origin decoder, which a script-src of 'self' already allows."
  - "Allowing static.cloudflareinsights.com in script-src loads the Web Analytics beacon, but its report to cloudflareinsights.com also needs connect-src."
  - "Check a CSP in a real browser and listen for securitypolicyviolation events, because a policy can load a script and still block what that script sends."
---

When Cloudflare proxies a site, the HTML a browser gets is not the HTML your build wrote. Rocket Loader, Email Address Obfuscation, and Web Analytics each rewrite the page, and a Content-Security-Policy (CSP) has to allow what they add. On this site, `'self'` covers the first two, but the analytics beacon also needs `connect-src`, and a live check showed the blog's policy blocking it.

The [hardening post](/hardening-a-static-site/) listed these rewrites in passing. This post shows each one in the live HTML of [sanjayhona.com.np](https://sanjayhona.com.np) and [blog.sanjayhona.com.np](https://blog.sanjayhona.com.np), what the policy needs, and how to check it.

## Seeing the HTML Cloudflare actually serves

The build output is in `dist/`. The served page is one `curl` away. Comparing the `<script>` tags in each is the fastest way to see what the edge adds:

```bash
npm run build
grep -oE '<script[^>]*>' dist/index.html

curl -sS https://sanjayhona.com.np/ | grep -oE '<script[^>]*>'
```

The build has three script tags: the JSON-LD block, the inline theme bootstrap, and one bundled module:

```html
<script type="application/ld+json">
<script data-cfasync="false">
<script type="module" src="/_astro/Base.astro_astro_type_script_index_0_lang.cznKQpn3.js">
```

The live page, fetched on 2026-09-23, has five:

```html
<script type="application/ld+json">
<script data-cfasync="false">
<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js">
<script type="536d89c04fb43d426f5288f4-module" src="/_astro/Base.astro_astro_type_script_index_0_lang.cznKQpn3.js">
<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js" data-cf-settings="536d89c04fb43d426f5288f4-|49" defer>
```

Two of those are new, and one of the originals changed its `type`. The sections below take them one at a time.

## Rocket Loader and `data-cfasync="false"`

[Rocket Loader](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/) prefixes each script's `type` with a random token, here `536d89c04fb43d426f5288f4-module`. The browser does not recognize that type, so it skips the script. Rocket Loader's own deferred script, whose `data-cf-settings` carries the same token, then runs the scripts itself. After the page loaded in Chromium, the bundled script's `type` was back to `module`.

That is fine for the bundled module. It is wrong for the theme bootstrap, a few inline lines in `<head>` that apply a saved light theme before first paint. If it runs late, a light-theme visitor sees the dark default first. The commit that fixed it says it added `data-cfasync="false"` "so Rocket Loader no longer defers it (restores no-flash for light-theme visitors)". The layout carries the note next to the tag:

```astro
<!-- data-cfasync="false": Cloudflare Rocket Loader must not defer this. -->
<script is:inline data-cfasync="false" set:html={themeBootstrap} />
```

`data-cfasync="false"` is the per-script opt-out in [Cloudflare's docs](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/ignore-javascripts/). The attribute is not part of the script's text, so it does not change the script's hash, and the CSP hash that `src/lib/theme.ts` computes at build time still matches.

For the CSP, Rocket Loader needs nothing special here. Its script is served from `/cdn-cgi/` on the same host, and the scripts it runs are the same same-origin files. `script-src 'self'` covers both.

## Email Address Obfuscation and `/cdn-cgi/l/email-protection`

[Email Address Obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/) hides addresses from scrapers that do not run JavaScript. On the live home page it made four changes:

- The three `mailto:` links became `href="/cdn-cgi/l/email-protection#<hex>"`.
- The address shown as link text became `<span class="__cf_email__" data-cfemail="<hex>">[email&#160;protected]</span>`.
- In the command palette, the address shown as a hint inside a `<button>` became an `<a class="__cf_email__">`, a link inside a button, until the decoder runs.
- A decoder script, `email-decode.min.js`, was added with `data-cfasync="false"` so Rocket Loader leaves it alone.

The encoding is a single-byte XOR (exclusive or). The first byte of the hex string is the key, and every later byte XORed with it gives one character. This decodes the `data-cfemail` value from the live page:

```python
h = "d7b3b2a1b8a7a497a4b6b9bdb6aebfb8b9b6f9b4b8baf9b9a7"
key = int(h[:2], 16)
print("".join(chr(int(h[i:i+2], 16) ^ key) for i in range(2, len(h), 2)))
# devops@sanjayhona.com.np
```

The decoder does the same in the browser. It sets each protected link's `href` back to `mailto:`, replaces each `.__cf_email__` element with a plain text node, repeats that inside `<template>` contents, and then removes its own `<script>` tag. After load in Chromium the home page had three `mailto:` links, no `.__cf_email__` elements, and no links left inside buttons. Without JavaScript, the visitor sees `[email protected]`.

The rewrite only touched the `href` values and the visible text. The `data-copy` and `data-arg` attributes that the copy button and the command palette read still held the plain address, and so did the `email` field in the JSON-LD. If you need a block left alone, the docs describe wrapping it in `<!--email_off-->` and `<!--/email_off-->` comments.

For the CSP, the decoder is another same-origin `/cdn-cgi/` script, so `'self'` covers it.

## Web Analytics beacon: `script-src` and `connect-src`

[Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/) can inject its beacon at the edge. On 2026-09-23 the blog's HTML included it, already re-typed by Rocket Loader. The apex page fetched the same day did not.

```html
<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{...}' type="b224b227ef876ba5ee22e364-text/javascript">
```

The site and the blog share one policy, `src/lib/csp.mjs`, and its comment explains the script allowance:

```js
// Cloudflare injects same-origin /cdn-cgi/ scripts and its Web Analytics
// beacon, hence 'self' and static.cloudflareinsights.com.
export const csp = {
  directives: [
    "default-src 'self'",
    // ...
  ],
  scriptDirective: {
    resources: ["'self'", "https://static.cloudflareinsights.com"],
  },
```

That allowance works: `beacon.min.js` loaded with a 200. Loading a script is only half of what the beacon does, though. It then sends its data to a different host, and Chromium refused that request:

```text
Refused to connect to 'https://cloudflareinsights.com/cdn-cgi/rum' because it violates the following Content Security Policy directive: "default-src 'self'". Note that 'connect-src' was not explicitly set, so 'default-src' is used as a fallback.
```

The policy sets no [`connect-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src), so fetch and beacon requests fall back to [`default-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/default-src), which is `'self'`. The beacon script runs, and the request that carries its data is blocked. In a browser that enforces CSP, that page view never reaches Web Analytics.

There are two consistent fixes. Keep the analytics and add `connect-src 'self' https://cloudflareinsights.com` to the policy. Or turn Web Analytics off for the host and drop `static.cloudflareinsights.com` from `script-src`, so the policy stops allowing a script whose output it blocks.

## Checking a CSP against the live page in Chromium

The hardening post reported zero violations when the policy was tested against a local copy with the rewrites applied. The live blog showed two, both for the beacon's report. Static checks of the HTML confirm what gets loaded. They do not see what a script requests after it runs.

A browser session does. With [Playwright](https://playwright.dev/docs/network), register a `securitypolicyviolation` listener before any page script runs, log requests, and wait a few seconds after `load`:

```js
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log(`console.${m.type()}: ${m.text()}`));
page.on("request", (r) => console.log(`${r.method()} ${r.url()}`));
await page.addInitScript(() =>
  document.addEventListener("securitypolicyviolation", (e) =>
    console.log(`CSP ${e.violatedDirective} ${e.blockedURI}`),
  ),
);
await page.goto("https://blog.sanjayhona.com.np/", { waitUntil: "load" });
await page.waitForTimeout(5000);
await browser.close();
```

For the blog this printed `CSP connect-src https://cloudflareinsights.com/cdn-cgi/rum`. For the apex it printed no violations, and the request log showed both `/cdn-cgi/` scripts loading from the same origin.

## What each rewrite needs from the policy

| Edge feature | What changes in the HTML | What the CSP needs | Opt-out |
|---|---|---|---|
| Rocket Loader | Script `type` gets a random prefix; adds `/cdn-cgi/scripts/.../rocket-loader.min.js` | `script-src 'self'` | `data-cfasync="false"` per script, or turn it off |
| Email Address Obfuscation | `mailto:` becomes `/cdn-cgi/l/email-protection#<hex>`; visible addresses become `.__cf_email__`; adds `email-decode.min.js` | `script-src 'self'` | `<!--email_off-->` blocks, or turn it off |
| Web Analytics (injected) | Adds `beacon.min.js` from `static.cloudflareinsights.com` | `script-src https://static.cloudflareinsights.com` and `connect-src https://cloudflareinsights.com` | Turn it off for the host |

Edge headers such as `frame-ancestors` are a separate layer, covered in [security headers and HSTS preload as code](/security-headers-and-hsts-preload-as-code/). The rewrites in this post happen inside the body, and the only way to know them is to read the page the browser gets and run it.
