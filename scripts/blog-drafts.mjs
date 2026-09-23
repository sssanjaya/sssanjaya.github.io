// Weekly AI draft generator for the blog. Writes draft outlines (draft: true)
// to blog/src/content/posts/ for a human to edit, schedule, and publish.
// Nothing here publishes: drafts never build into the live site.
//
// Grounding, in priority order: blog/ideas.md (your notes), the experience
// and site data, and existing posts (to avoid repeats). The prompt forbids
// invented incidents, numbers, or employer details; specifics become
// "TODO(you):" placeholders.
//
// Env: ANTHROPIC_API_KEY (or any credential the SDK resolves)
//      DRAFT_COUNT  number of drafts, default 3
// Prints the created file paths, one per line.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const POSTS = "blog/src/content/posts";
const COUNT = Math.min(Math.max(Number(process.env.DRAFT_COUNT ?? 3) || 3, 1), 5);

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

function existingPosts() {
  return readdirSync(POSTS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const src = read(`${POSTS}/${f}`);
      const fm = src.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
      const get = (k) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.replace(/^["']|["']$/g, "") ?? "";
      return { slug: f.replace(/\.md$/, ""), title: get("title"), tags: get("tags"), draft: /^draft:\s*true/m.test(fm) };
    });
}

const SCHEMA = {
  type: "object",
  properties: {
    drafts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slug: { type: "string", description: "kebab-case URL slug, 3-8 words" },
          title: { type: "string" },
          description: { type: "string", description: "One or two sentences, max 170 characters" },
          tags: { type: "array", items: { type: "string" } },
          source: { type: "string", description: "Which input this idea comes from, e.g. 'ideas.md: SHA pinning bullet'" },
          body: { type: "string", description: "Markdown outline: ## section headings, bullet points of what to cover, TODO(you): placeholders" },
        },
        required: ["slug", "title", "description", "tags", "source", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["drafts"],
  additionalProperties: false,
};

const SYSTEM = `You draft blog post outlines for Sanjay Hona, a Site Reliability Engineer (DevOps, DevSecOps, SRE; learning AIOps). His blog "Field notes" publishes incident write-ups, runbooks, and lessons from running cloud and edge infrastructure, written for the next person on call.

Your output is a starting point he will rewrite, not a finished post. Rules:
- Ground every draft in the provided material. Prefer ideas.md; then his experience and site data. Name the source in "source".
- Never invent incidents, outages, numbers, dates, customer or employer details, or quotes. Where a post needs a real specific, write a "TODO(you): ..." placeholder describing exactly what to fill in.
- Do not repeat topics already covered by existing posts or pending drafts.
- The body is an outline: 4-7 "##" sections, each with 2-5 bullets of what to cover, plus code or config block placeholders where useful. No intro fluff.
- Voice: first person, plain everyday English, short sentences, active voice. No em dashes. Avoid: delve, leverage, robust, seamless, comprehensive, utilize, harness, foster, empower, elevate, transform, innovative, strategic, cutting-edge, game changer, landscape, insights, holistic, synergy.
- Tags: 2-4 lowercase tags.`;

async function main() {
  const posts = existingPosts();
  const recentCommits = (() => {
    try { return execSync("git log --no-merges -n 30 --pretty=%s", { encoding: "utf8" }); } catch { return ""; }
  })();

  const material = [
    `## ideas.md (his notes, highest priority)\n${read("blog/ideas.md")}`,
    `## Experience data\n${read("src/data/experience.ts")}`,
    `## Site data (skills, stack, what he is learning)\n${read("src/data/site.ts")}`,
    `## Recent commits to his site repo\n${recentCommits}`,
    `## Existing posts and pending drafts (do not repeat)\n${posts.map((p) => `- ${p.slug}: ${p.title} [${p.tags}]${p.draft ? " (draft)" : ""}`).join("\n")}`,
  ].join("\n\n");

  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    // Server-side refusal fallback: if the model declines, the API re-runs the
    // request on Anthropic's recommended fallback model instead of failing.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `${material}\n\nWrite ${COUNT} draft outlines.` }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`model declined: ${response.stop_details?.category ?? "unknown"} ${response.stop_details?.explanation ?? ""}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("response hit max_tokens before finishing");

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("no text block in response");
  const { drafts } = JSON.parse(text);

  // First draft date: a week out, then one per day. Drafts stay hidden until
  // draft: true is removed, so this is only a suggested schedule.
  const start = new Date(Date.now() + 7 * 864e5);
  const taken = new Set(posts.map((p) => p.slug));
  const created = [];
  drafts.forEach((d, i) => {
    let slug = d.slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    if (!slug || taken.has(slug)) slug = `${slug || "draft"}-${Date.now().toString(36)}-${i}`;
    taken.add(slug);
    const date = new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10);
    const q = (s) => JSON.stringify(String(s));
    const file = `${POSTS}/${slug}.md`;
    writeFileSync(
      file,
      `---\ntitle: ${q(d.title)}\ndescription: ${q(d.description.slice(0, 170))}\ndate: ${date}\ntags: [${d.tags.map((t) => q(t.toLowerCase())).join(", ")}]\ndraft: true\n---\n\n` +
        `<!-- AI draft outline. Source: ${d.source.replace(/-->/g, "")}. Rewrite in your own words, fill every TODO(you), then remove draft: true. -->\n\n` +
        `${d.body.trim()}\n`,
    );
    created.push(file);
  });

  const u = response.usage;
  console.error(`model=${response.model} input=${u.input_tokens} output=${u.output_tokens}`);
  console.log(created.join("\n"));
}

main().catch((e) => {
  if (e instanceof Anthropic.AuthenticationError) console.error("::error::Anthropic authentication failed: check ANTHROPIC_API_KEY");
  else if (e instanceof Anthropic.RateLimitError) console.error("::error::Anthropic rate limit hit; re-run later");
  else if (e instanceof Anthropic.APIError) console.error(`::error::Anthropic API error ${e.status}: ${e.message}`);
  else console.error(`::error::${e.message}`);
  process.exit(1);
});
