---
title: "Proving an npm upgrade changed nothing with pixelmatch"
description: "Pixel-diff old and new builds with Playwright and pixelmatch, then byte-diff the HTML with diff -r, to prove a dependency upgrade or refactor changed nothing."
date: 2026-09-25
tags: [astro, static-sites, testing, dependabot]
takeaways:
  - "Build the site before and after an upgrade, screenshot every page in each viewport and theme, and require pixelmatch to report zero differing pixels."
  - "Freeze the browser clock and pin the theme before each screenshot, or a live clock or stored preference shows up as a false difference."
  - "A pixel diff misses changes that do not render, such as a trailing space that CSS drops at the end of a line."
  - "For a refactor, the built HTML should be byte-identical, and diff -r plus cmp finds the exact byte that moved."
  - "Build both sides from the same commit, because a static site that stamps its commit hash or build date into the page differs on those alone."
---

To prove a dependency upgrade changed nothing, build the site with the old and new dependencies, screenshot every page in every viewport and theme, and count differing pixels with [pixelmatch](https://github.com/mapbox/pixelmatch). Zero means the upgrade can merge without anyone comparing screenshots by eye. For a refactor, pixels are the wrong check: diff the built HTML byte for byte, because some changes never reach the screen.

I used both checks on this site. Before merging seven Dependabot pull requests, one of them a critical remote code execution fix in Astro's image optimizer that was not reachable in a static build, I pixel-diffed old and new builds at desktop and mobile widths in dark and light themes. Zero pixels changed. Later, when I moved shared code into modules so the blog could reuse it, I byte-diffed the main site's HTML. It came out identical except for one stray trailing space, and only the byte diff caught it. [Hardening a static site](/hardening-a-static-site/) covers the upgrades themselves.

## Pixel-diffing two builds with Playwright and pixelmatch

The setup is two static builds served side by side. For this repo, `npm run build` writes the main site to `dist/`. Build once on the old lockfile and copy `dist/` to `old/`, then install the new dependencies, build again, and copy it to `new/`. Serve each on its own port:

```bash
python3 -m http.server 4001 -d old &
python3 -m http.server 4002 -d new &
```

The script below takes a full-page screenshot of every HTML page in both builds with [Playwright](https://playwright.dev/docs/screenshots), in two viewports and both themes, and compares each pair:

```js
// Screenshot every page from two local builds and count differing pixels.
import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { readdirSync, writeFileSync } from "node:fs";

const [oldBase, newBase] = ["http://localhost:4001", "http://localhost:4002"];
// Every HTML page in the old build, as a URL path.
const pages = readdirSync("old", { recursive: true })
  .filter((f) => f.endsWith(".html"))
  .map((f) => "/" + f.replace(/index\.html$/, ""));
const viewports = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
const themes = ["dark", "light"];

const browser = await chromium.launch();
let failed = false;

async function shot(base, path, viewport, theme) {
  const page = await browser.newPage({ viewport });
  await page.clock.setFixedTime(new Date("2026-01-01T12:00:00Z"));
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto(base + path, { waitUntil: "networkidle" });
  const png = PNG.sync.read(await page.screenshot({ fullPage: true, animations: "disabled" }));
  await page.close();
  return png;
}

for (const path of pages) {
  for (const [name, viewport] of Object.entries(viewports)) {
    for (const theme of themes) {
      const a = await shot(oldBase, path, viewport, theme);
      const b = await shot(newBase, path, viewport, theme);
      if (a.width !== b.width || a.height !== b.height) {
        console.log(`${path} ${name} ${theme}: size ${a.width}x${a.height} -> ${b.width}x${b.height}`);
        failed = true;
        continue;
      }
      const diff = new PNG({ width: a.width, height: a.height });
      const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0 });
      console.log(`${path} ${name} ${theme}: ${n} pixels differ`);
      if (n > 0) {
        failed = true;
        writeFileSync(`diff-${name}-${theme}-${path.replaceAll("/", "_")}.png`, PNG.sync.write(diff));
      }
    }
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
```

A few details matter:

- `threshold: 0` counts any color change. The pixelmatch default is `0.1`, which ignores small color differences. For "changed nothing", any difference is a failure.
- A full-page screenshot changes height when content moves. pixelmatch requires both images to be the same size, so the script reports a size change as its own failure instead of cropping.
- When a page fails, the script writes a diff image with the changed pixels marked, so you can see where the change is without comparing two screenshots by eye.
- The exit code is `1` on any difference, so the same script can gate a pull request.

## Removing false differences before you screenshot

A pixel diff is only useful if identical code gives identical pixels. Anything that varies between two loads of the same page has to be pinned first. On this site there are two such things.

The header has a live clock. `src/scripts/console.ts` formats the current time and refreshes it with `window.setInterval(tick, 15_000)`. Two screenshots taken either side of a minute boundary would differ. [`page.clock.setFixedTime`](https://playwright.dev/docs/clock) makes `Date` return the same moment in every page, so both builds show the same time.

The theme comes from `localStorage`. The inline bootstrap in `src/lib/theme.ts` applies the light theme only when `localStorage.getItem("theme") === "light"`, and dark is the default. `page.addInitScript` sets that key before any page script runs, so each screenshot gets the theme the loop asked for.

I checked that the script sees real changes. Two builds of the current site, served as `old/` and `new/`, gave 0 differing pixels on every page, viewport, and theme. Changing one hex digit of the commit hash in the footer of `new/index.html` gave 33 differing pixels in the dark theme and 29 in the light theme at both widths, and a diff image for each.

## Build both sides from the same commit

That footer is the other source of false differences, and it comes from the build, not the browser. `src/components/SiteFooter.astro` runs `git rev-parse --short HEAD` at build time and prints the result, followed by the build date in UTC:

```astro
const built = new Date();
const stamp = built.toISOString().slice(0, 10);
```

Build the old and new versions from two different commits and the footer differs by its hash, which the check above shows is enough to fail it. Build them either side of midnight UTC and the date differs. The simplest fix is to build both from the same commit on the same day and change only `node_modules`: build, copy `dist/`, swap in the new lockfile, `npm ci`, build again. Two builds of the same commit of this repo, run one after the other, were byte-identical, so the build has no other source of variation.

## Byte-diffing a refactor with diff -r and cmp

A refactor should not change output at all, so the bar is higher than "looks the same". Compare the two `dist/` directories with [`diff -r`](https://www.gnu.org/software/diffutils/manual/diffutils.html), which exits `0` when every file matches:

```bash
diff -rq old new
```

Astro writes each page on this site as a few very long lines, so a line diff of a changed page prints most of the file. [`cmp`](https://www.gnu.org/software/diffutils/manual/diffutils.html#Invoking-cmp) reports the first byte that differs instead, and a slice around that offset shows the change:

```bash
off=$(cmp old/index.html new/index.html | awk '{print $5}' | tr -d ,)
for f in old new; do tail -c +$((off - 60)) "$f/index.html" | head -c 90; echo; done
```

## Why a trailing space passes a pixel diff

The refactor that moved shared code for the blog changed how the header breadcrumb is rendered. It used to be literal markup:

```astro
<span class="crumb" aria-hidden="true"><span>/</span> prod <span>/</span> {site.region}</span>
```

It became a list passed as a prop, so the blog can show its own path:

```astro
<span class="crumb" aria-hidden="true">{crumb.map((c, i) => <><span>/</span> {c}{i < crumb.length - 1 ? " " : ""}</>)}</span>
```

The conditional is what keeps the output identical. A space goes after every crumb except the last. With a space after every crumb, the only change is one byte before `</span>`, and the byte diff shows it:

```text
pan> prod <span data-astro-cid-nazmfhjt>/</span> ca-ottawa-1</span></a><nav class="nav" ar
pan> prod <span data-astro-cid-nazmfhjt>/</span> ca-ottawa-1 </span></a><nav class="nav" a
```

I rebuilt the site with that unconditional space and ran the pixel script against the current build. It reported 0 differing pixels on every page, viewport, and theme. The space is the last character on its line, and CSS removes a collapsible space at the end of a line ([`white-space`](https://developer.mozilla.org/en-US/docs/Web/CSS/white-space) on MDN covers the rules). It renders as nothing, so no screenshot can see it.

## Which check to use

| Change | Expected output | Check |
| --- | --- | --- |
| Dependency upgrade | HTML may change (new asset hashes, framework markup), pages must look the same | Pixel diff, `threshold: 0` |
| Refactor | Identical files | `diff -rq`, then `cmp` on any file that differs |
| Intended visual change | Some pixels change | Pixel diff, then review the diff images |

An upgrade usually changes bytes: a new framework version can rename hashed asset files or reorder attributes. Requiring byte-identical output there fails on changes nobody can see. A refactor has no such excuse, and the byte diff is the only one of the two checks that caught the trailing space. The [Dependabot](https://docs.github.com/en/code-security/dependabot) pull requests on this repo merged after the first check. The shared-module refactor for [the blog](/rebuilding-my-portfolio-as-an-ops-console/) merged after the second.
