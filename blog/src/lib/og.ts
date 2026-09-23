// Per-post social share card (1200×630 PNG), rendered at build time.
// satori lays out the card and draws the text as vector paths from the site's
// own fonts, and resvg rasterizes it, so the output doesn't depend on which
// fonts the build machine has installed.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { site } from "../../../src/data/site.ts";

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) =>
  readFileSync(require.resolve(`@fontsource/${pkg}/files/${file}`));

const fonts = [
  { name: "Space Grotesk", weight: 700, style: "normal", data: font("space-grotesk", "space-grotesk-latin-700-normal.woff") },
  { name: "Space Grotesk", weight: 500, style: "normal", data: font("space-grotesk", "space-grotesk-latin-500-normal.woff") },
  { name: "JetBrains Mono", weight: 400, style: "normal", data: font("jetbrains-mono", "jetbrains-mono-latin-400-normal.woff") },
  { name: "JetBrains Mono", weight: 500, style: "normal", data: font("jetbrains-mono", "jetbrains-mono-latin-500-normal.woff") },
] as const;

// Dark theme tokens from src/styles/global.css.
const c = {
  bg: "#080b10",
  panel: "#0d1218",
  line: "#1a222d",
  fg: "#e6ebf2",
  mut: "#8d99ab",
  dim: "#7a869a",
  ok: "#39e58c",
  info: "#62b6ff",
};

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string)[]): Node => ({
  type,
  // satori requires an explicit display on any element with several children.
  props: { style: { display: "flex", ...style }, children: children.length === 1 ? children[0] : children },
});

// Longer titles get a smaller size so they fit in three lines.
const titleSize = (t: string) => (t.length <= 40 ? 76 : t.length <= 64 ? 64 : 54);

export interface Card {
  slug: string;
  title: string;
  date: string;
  tags: string[];
}

export async function renderCard({ slug, title, date, tags }: Card): Promise<Buffer> {
  const mono = { fontFamily: "JetBrains Mono" };
  const tree = h(
    "div",
    {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "56px 64px 0",
      backgroundColor: c.bg,
      color: c.fg,
      fontFamily: "Space Grotesk",
    },
    // Top bar: status dot and the blog's host.
    h(
      "div",
      { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, ...mono },
      h(
        "div",
        { display: "flex", alignItems: "center", color: c.mut },
        h("div", { width: 14, height: 14, borderRadius: 7, backgroundColor: c.ok, marginRight: 14 }),
        "field notes",
      ),
      h("div", { color: c.dim }, "blog.sanjayhona.com.np"),
    ),
    // The post: a shell prompt, then the title.
    h(
      "div",
      { display: "flex", flexDirection: "column" },
      h(
        "div",
        { display: "block", fontSize: 26, color: c.ok, marginBottom: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...mono },
        `$ cat ${slug}.md`,
      ),
      h(
        "div",
        {
          fontSize: titleSize(title),
          fontWeight: 700,
          lineHeight: 1.08,
          letterSpacing: "-0.02em",
          lineClamp: 3,
          display: "block",
        },
        title,
      ),
    ),
    // Byline, tags and date, then a status strip along the bottom edge.
    h(
      "div",
      { display: "flex", flexDirection: "column" },
      h(
        "div",
        { display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingBottom: 36 },
        h(
          "div",
          { display: "flex", flexDirection: "column" },
          h("div", { fontSize: 30, fontWeight: 500 }, site.name),
          h("div", { fontSize: 20, color: c.mut, marginTop: 6, ...mono }, site.jobTitle),
        ),
        h(
          "div",
          { display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 20, ...mono },
          h("div", { color: c.info }, tags.slice(0, 3).map((t) => `#${t}`).join("  ")),
          h("div", { color: c.dim, marginTop: 6 }, date),
        ),
      ),
      h(
        "div",
        { display: "flex", margin: "0 -64px", borderTop: `1px solid ${c.line}`, padding: "14px 64px", backgroundColor: c.panel },
        ...Array.from({ length: 48 }, () =>
          h("div", { width: 14, height: 14, marginRight: 8, borderRadius: 3, backgroundColor: c.ok }),
        ),
      ),
    ),
  );

  const svg = await satori(tree as never, { width: 1200, height: 630, fonts: fonts as never });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}
