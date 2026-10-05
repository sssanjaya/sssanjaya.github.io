---
title: "Build-time Open Graph images in Astro with satori and resvg"
description: "Generate a 1200x630 Open Graph PNG per post in Astro at build time: satori lays out the card from local font files and resvg-js turns the SVG into a PNG."
date: 2026-10-06
tags: [astro, static-sites, seo]
takeaways:
  - "An Astro endpoint at src/pages/og/[slug].png.ts with getStaticPaths writes one share card PNG per post during a static build."
  - "satori converts a tree of elements into an SVG with text drawn as vector paths, so the result does not depend on fonts installed on the build machine."
  - "satori throws if a div with more than one child has no explicit display: flex, display: contents, or display: none."
  - "satori reads TTF, OTF, and WOFF font data but rejects WOFF2 with the error Unsupported OpenType signature wOF2."
  - "Building the card list from the same getPosts() function as the pages means a scheduled post gets no public card before its publish date."
---

Each post on this blog has its own 1200×630 share card at `/og/<slug>.png`, built once per post during `astro build`. [satori](https://github.com/vercel/satori) lays the card out as an SVG from the site's own font files, and [resvg-js](https://github.com/yisibl/resvg-js) rasterizes that SVG into a PNG. No headless browser, no image service, and no runtime: the cards are static files deployed next to the HTML.

The code is in `blog/src/lib/og.ts` (the card) and `blog/src/pages/og/[slug].png.ts` (the endpoint). The commit that added them states the goal: text is drawn as paths from the site's own Space Grotesk and JetBrains Mono files, "so CI renders the same pixels as a laptop."

## One PNG per post from an Astro endpoint

An [Astro endpoint](https://docs.astro.build/en/guides/endpoints/) is a `.ts` file in `src/pages` that exports `GET`. In a static build Astro calls it once per path and writes the response body to a file. With a dynamic segment and [`getStaticPaths`](https://docs.astro.build/en/reference/routing-reference/#getstaticpaths), one file produces one PNG per post:

```ts
// /og/<slug>.png: the post's social share card, built once per post.
import type { APIContext } from "astro";
import { renderCard } from "../../lib/og.ts";
import { getPosts, isoDate, type Post } from "../../lib/posts.ts";

export async function getStaticPaths() {
  const posts = await getPosts();
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}

export async function GET({ props }: APIContext<{ post: Post }>) {
  const { id, data } = props.post;
  const png = await renderCard({ slug: id, title: data.title, date: isoDate(data.date), tags: data.tags });
  return new Response(png, { headers: { "Content-Type": "image/png" } });
}
```

The file is named `[slug].png.ts`, so Astro drops the `.ts` and writes `dist/og/<slug>.png`. The build log lists each one:

```text
├─ /og/css-grid-1fr-mobile-overflow.png (+63ms)
├─ /og/package-lock-churn-npm-versions.png (+69ms)
```

`getPosts()` is the same function the post pages, the RSS feed, and `/llms.txt` use. In a production build it drops drafts and posts dated after build time. A post queued for next week therefore has no card in `dist/og/` until the build that publishes its page. The scheduling side is in [how this blog publishes on a schedule with no backend](/publishing-on-a-schedule-with-no-backend/), and the other endpoints that share this list are in [llms.txt and a Markdown copy of every post](/llms-txt-markdown-copies-astro/).

## Laying out the card with satori

satori takes a tree of elements shaped like React elements, `{ type, props: { style, children } }`, and returns an SVG string. It supports a subset of CSS built on flexbox. JSX is optional. `og.ts` builds the tree with a three-line helper instead:

```ts
type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string)[]): Node => ({
  type,
  // satori requires an explicit display on any element with several children.
  props: { style: { display: "flex", ...style }, children: children.length === 1 ? children[0] : children },
});
```

That default `display: "flex"` is there because satori refuses a `div` with several children and no display set. Without it, the build fails with:

```text
Expected <div> to have explicit "display: flex", "display: contents", or "display: none" if it has more than one child node.
```

The card itself is three stacked rows inside a 1200×630 box with `justifyContent: "space-between"`: a top bar with a status dot and the blog's host name, a `$ cat <slug>.md` line over the title, and a byline with the author, job title, up to three tags, and the date. A strip of 48 small squares runs along the bottom edge. The colors are hex values copied from the dark theme tokens in `src/styles/global.css`.

Long titles get a smaller font so they fit in three lines:

```ts
// Longer titles get a smaller size so they fit in three lines.
const titleSize = (t: string) => (t.length <= 40 ? 76 : t.length <= 64 ? 64 : 54);
```

The title element also sets `lineClamp: 3`, and the slug line sets `whiteSpace: "nowrap"`, `overflow: "hidden"`, and `textOverflow: "ellipsis"`, so neither can push the byline off the card. Both of those elements set `display: "block"`, which overrides the helper's default, since each holds a single text child.

## Loading fonts from @fontsource for satori

satori does not read system fonts. Every font it can use is passed in as raw bytes. If the list is empty, it throws `No fonts are loaded. At least one font is required to calculate the layout.` This repo already depends on the [Fontsource](https://fontsource.org/) packages for the site, so `og.ts` reads the files from `node_modules`:

```ts
const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) =>
  readFileSync(require.resolve(`@fontsource/${pkg}/files/${file}`));

const fonts = [
  { name: "Space Grotesk", weight: 700, style: "normal", data: font("space-grotesk", "space-grotesk-latin-700-normal.woff") },
  { name: "Space Grotesk", weight: 500, style: "normal", data: font("space-grotesk", "space-grotesk-latin-500-normal.woff") },
  { name: "JetBrains Mono", weight: 400, style: "normal", data: font("jetbrains-mono", "jetbrains-mono-latin-400-normal.woff") },
  { name: "JetBrains Mono", weight: 500, style: "normal", data: font("jetbrains-mono", "jetbrains-mono-latin-500-normal.woff") },
] as const;
```

The files are `.woff`, not `.woff2`. satori accepts TTF, OTF, and WOFF. Handing it the WOFF2 file from the same package fails with:

```text
Unsupported OpenType signature wOF2
```

`require.resolve` through `createRequire` finds the file wherever npm installed the package, so the path does not depend on the working directory of the build.

Because satori converts every glyph into an SVG `<path>`, the SVG it returns contains no `<text>` elements. A one-word test render produced zero `<text>` tags and one `<path>`. The next step never has to resolve a font name, which is what makes the output the same on a laptop and on a GitHub Actions runner.

## Rasterizing the SVG to PNG with resvg-js

Social platforms expect a raster image for `og:image`, so the SVG goes through resvg-js, the Node.js binding for the Rust SVG renderer resvg:

```ts
const svg = await satori(tree as never, { width: 1200, height: 630, fonts: fonts as never });
return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
```

`fitTo` with `mode: "width"` scales the output to 1200 pixels wide, which matches the SVG, so the PNG comes out at 1200×630:

```bash
$ file blog/dist/og/hardening-a-static-site.png
blog/dist/og/hardening-a-static-site.png: PNG image data, 1200 x 630, 8-bit/color RGBA, non-interlaced
```

The cards in the current build are 48 to 56 KB each. In a local build of this repo, the first card took about 1.75 seconds and each later one 60 to 130 milliseconds, so the cost per added post is small.

resvg-js ships prebuilt native binaries as platform-specific optional packages under `@resvg/*`. CI installs with `npm ci --ignore-scripts`, and the build still works, because those binaries arrive as regular packages rather than through an install script. They are also among the packages whose `libc` fields show up in the lockfile, covered in [package-lock.json churn between npm 10 and npm 11](/package-lock-churn-npm-versions/).

## Wiring the card into og:image and JSON-LD

The post page, `blog/src/pages/[slug].astro`, passes the card path and an alt text to the shared layout as two props:

```astro
image={`/og/${post.id}.png`} imageAlt={`${title}, by ${site.name}`}
```

`src/layouts/Base.astro` turns the path into an absolute URL with `new URL(image, Astro.site).href` and writes the [Open Graph](https://ogp.me/) and X tags. The built page for one post shows the result:

```html
<meta property="og:image" content="https://blog.sanjayhona.com.np/og/hardening-a-static-site.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Hardening a static site: pinned actions, least privilege, and a CSP that can't drift, by Sanjay Hona">
<meta name="twitter:image" content="https://blog.sanjayhona.com.np/og/hardening-a-static-site.png">
<meta name="twitter:image:alt" content="Hardening a static site: pinned actions, least privilege, and a CSP that can't drift, by Sanjay Hona">
```

The `BlogPosting` JSON-LD points at the same file as an `ImageObject` with `width: 1200` and `height: 630`. The blog index does not pass `image`, so it keeps the site-wide default card `/og.png` from `src/data/site.ts`.

## Dependency notes for satori and resvg-js

The commit added both as exact-version dev dependencies:

```json
"devDependencies": {
  "@resvg/resvg-js": "2.6.2",
  "satori": "0.33.4"
}
```

satori 0.33.4 declares `"fflate": "0.7.3"`. The commit message notes that version is affected by advisory GHSA-px8p-9vwx-vf98, rated moderate, so `package.json` adds an [npm override](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#overrides) to the patched release:

```json
"overrides": {
  "esbuild": "^0.28.1",
  "fflate": "0.7.5"
}
```

`npm ls fflate` confirms it, ending with `fflate@0.7.5 overridden`. When satori is upgraded, check whether its own `fflate` requirement has moved past the advisory. If it has, the override can go.

## What to check when the cards change

| Check | Command or place | What it proves |
| --- | --- | --- |
| Size | `file blog/dist/og/<slug>.png` | The PNG is 1200 x 630 |
| Meta tags | `grep 'og:image' blog/dist/<slug>/index.html` | The page points at its own card |
| Scheduled posts | `ls blog/dist/og/` | No card exists for a future-dated post |
| Look | Open the PNG | Long titles fit in three lines |

The card is part of the build output, so a layout change to `og.ts` touches every PNG at once. Opening two or three cards with the longest and shortest titles after a change is a fast way to catch overflow before it reaches a link preview.
