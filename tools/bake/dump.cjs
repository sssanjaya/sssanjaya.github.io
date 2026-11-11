// Step 1 of the bake: read the scene out of the page.
// usage: node tools/bake/dump.cjs <dev server url> <out dir>
// The dev server (npm run dev) serves the page with ?bake, which makes the
// scene lay out its lightmap charts afresh and expose window.__bake().
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
(async () => {
  const [url, out] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
  const page = await (await browser.newContext({ viewport: { width: 800, height: 600 }, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 300)));
  page.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 300)));
  await page.addInitScript(() => localStorage.setItem("rack", "on"));
  await page.goto(`${url.replace(/\/$/, "")}/?bake`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__bake === "function", null, { timeout: 180000 });
  const scene = await page.evaluate(() => window.__bake());
  fs.writeFileSync(path.join(out, "scene.json"), JSON.stringify(scene));
  const kinds = {};
  for (const m of scene.meshes) kinds[m.kind] = (kinds[m.kind] || 0) + 1;
  console.log(scene.rects.length, "lit meshes;", JSON.stringify(kinds));
  await browser.close();
})();
