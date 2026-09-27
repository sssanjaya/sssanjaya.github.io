---
title: "CSS grid 1fr column causing horizontal scroll on mobile"
description: "A CSS grid 1fr column can't shrink below its content, so a wide code block widens the page on phones. Use minmax(0, 1fr) or min-width: 0 on the item."
date: 2026-09-28
tags: [css, astro, static-sites, testing]
takeaways:
  - "A grid track sized 1fr means minmax(auto, 1fr), so it cannot shrink below the automatic minimum size of the item inside it."
  - "A wide code block inside a grid item raises that item's min-content width, which widens the column and makes the whole page scroll sideways on a phone."
  - "grid-template-columns: minmax(0, 1fr) lets the track shrink to zero, and min-width: 0 on the grid item removes its automatic minimum; either one alone stops the overflow."
  - "overflow-x: auto on pre only helps once the column is narrow; it has nothing to scroll while the grid keeps the column as wide as the code."
  - "A headless browser check that compares document.documentElement.scrollWidth with clientWidth at a phone viewport catches this class of bug before a post ships."
---

A post page on this blog once rendered 632px wide on a phone, so the whole page scrolled sideways. The cause was a CSS grid column sized `1fr`: it cannot shrink below the min-content width of what it holds, and a long line in a code block made that width large. The fix is `grid-template-columns: minmax(0, 1fr)` on the grid, plus `min-width: 0` on the grid item. A local [Playwright](https://playwright.dev/) check caught it before the post went live.

Below is why `1fr` behaves this way, the exact CSS the blog uses now, measurements of each fix on its own, and a script that finds pages wider than the viewport.

## The post layout that overflowed

A post page in `blog/src/pages/[slug].astro` puts the article body and a table of contents side by side when the post has headings. The body is the `.prose` element and the table of contents is `.toc`:

```css
.layout.has-toc {
  display: grid;
  grid-template-columns: minmax(0, 760px) 220px;
  gap: 64px;
  align-items: start;
}
.prose {
  max-width: 760px;
  min-width: 0;
}
```

At 1080px and below, the table of contents is hidden and the grid drops to one column:

```css
@media (max-width: 1080px) {
  .layout.has-toc {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
  .toc {
    display: none;
  }
}
```

Code blocks already scroll on their own. `blog/src/styles/prose.css` sets `overflow-x: auto` on `.prose pre`. That rule only helps when the `pre` is narrower than its content. If the column grows to fit the code, the `pre` has nothing to scroll and the page scrolls instead.

## Why a 1fr grid column won't shrink below its content

The [`fr` unit](https://developer.mozilla.org/en-US/docs/Web/CSS/flex_value) used alone as a track size is shorthand for `minmax(auto, 1fr)`. The `auto` minimum resolves to the grid item's [automatic minimum size](https://www.w3.org/TR/css-grid-2/#min-size-auto). For an item that is not a scroll container, that minimum is based on its min-content size: the width of its longest piece of content that cannot wrap.

A line of code is a single unbreakable run, because `pre` does not wrap. So the min-content width of `.prose` becomes the width of the longest code line plus the `pre` padding. The grid track honours that minimum, the column grows past the viewport, and `document.documentElement` becomes scrollable sideways. The `max-width: 760px` on `.prose` caps how far it grows, which is why the page stopped at a finite width instead of the full length of the line.

There are two ways to remove that floor:

- [`minmax(0, 1fr)`](https://developer.mozilla.org/en-US/docs/Web/CSS/minmax) replaces the `auto` minimum on the track with `0`.
- [`min-width: 0`](https://developer.mozilla.org/en-US/docs/Web/CSS/min-width) on the grid item replaces its automatic minimum with `0`, so an `auto` track has nothing to hold it open.

The blog uses both.

## Measuring each fix at a 390px viewport

I built the blog with `npm run build:blog`, loaded [publishing a blog on a schedule with no backend](/publishing-on-a-schedule-with-no-backend/) in headless Chromium at 390 by 844 pixels, and overrode the two rules with an injected stylesheet. `scrollWidth` is `document.documentElement.scrollWidth`. The viewport's `clientWidth` was 390px in every case.

| Track | `.prose` `min-width` | `.prose` width | `scrollWidth` |
| --- | --- | --- | --- |
| `minmax(0, 1fr)` | `0` | 358px | 390px |
| `1fr` | `0` | 358px | 390px |
| `minmax(0, 1fr)` | `auto` | 358px | 390px |
| `1fr` | `auto` | 624px | 656px |

Only the combination of both defaults overflows. Either rule alone keeps the column at 358px, which is the viewport minus the page padding, and the code block scrolls inside itself. With both in place, removing either one alone still leaves the layout intact.

The same override on other posts gave different widths, because each post's longest code line is different.

## A Playwright check for pages wider than the viewport

The check that caught this was a local Playwright run, not a CI job. The script below runs the same kind of check. It opens each path at a phone viewport, compares `scrollWidth` with `clientWidth`, and names the innermost elements that overflow. It skips anything inside `pre` and `table`, because the blog makes both of those scroll on purpose.

```js
import { chromium } from "playwright";

// Usage: node overflow-check.mjs http://localhost:4321 / /some-post/
const [base, ...paths] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let failed = 0;

for (const path of paths) {
  await page.goto(base + path);
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    // Elements that overflow and do not scroll themselves. Code blocks and
    // tables scroll on purpose, so skip what is inside them.
    const wide = [...document.querySelectorAll("body *")].filter(
      (el) =>
        !el.parentElement.closest("pre, table") &&
        getComputedStyle(el).overflowX === "visible" &&
        el.scrollWidth > el.clientWidth + 1,
    );
    // Keep the innermost ones: they are where the overflow starts.
    const innermost = wide.filter((el) => !wide.some((o) => o !== el && el.contains(o)));
    return {
      scroll: root.scrollWidth,
      client: root.clientWidth,
      culprits: innermost.map((el) => el.tagName.toLowerCase() + (el.className ? "." + el.className : "")),
    };
  });
  if (result.scroll > result.client) {
    failed++;
    console.log(`${path}: ${result.scroll}px wide in a ${result.client}px viewport`, result.culprits);
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
```

Serve `blog/dist` on port 4321 with any static file server, then pass the paths to check. The script exits with status 1 when any page is too wide, so it can gate a build later. The [viewport option](https://playwright.dev/docs/emulation#viewport) is what makes Chromium lay the page out at phone width.

## What minmax(0, 1fr) does not fix

The grid fix only stops a grid track from growing. It does nothing for an element that overflows its own box. Running the script above against the current build flags one post:

```text
/queryselectorall-data-attribute-hook-collision/: 441px wide in a 390px viewport [ 'h1', 'li' ]
```

The title of that post contains `document.querySelectorAll`, one long word with no break opportunity, so the `h1` text runs past the right edge of its 358px box. The `li` is a takeaway with long inline code; it overflows its own box but stays inside the viewport. The grid column itself is still 358px wide. Adding [`overflow-wrap: anywhere`](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap) to the heading brought `scrollWidth` back to 390px in the same test. So the full list for this class of bug has two entries: a zero minimum on grid tracks and items, and a wrap rule for long unbroken words in text.

## Related checks on this site

The same Playwright setup, with a frozen clock and full-page screenshots, is how I compare two builds in [proving an npm upgrade changed nothing](/pixel-diff-dependency-upgrades/).
