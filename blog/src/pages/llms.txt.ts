// /llms.txt: a Markdown index of the blog for LLMs and agents
// (https://llmstxt.org). Each entry links the post's Markdown copy.
import { blog, getPosts, isoDate, markdownUrl, SITE } from "../lib/posts.ts";
import { site } from "../../../src/data/site.ts";

export async function GET() {
  const posts = await getPosts();
  const lines = [
    `# ${blog.title}`,
    "",
    `> ${blog.description}`,
    "",
    `Written by ${site.name}, ${site.jobTitle} in ${site.location}. Portfolio: ${site.url}`,
    `Every post is also available as Markdown at ${SITE}/<slug>.md, and all posts in one file at ${SITE}/llms-full.txt.`,
    "",
    "## Posts",
    "",
    ...posts.map((p) => `- [${p.data.title}](${markdownUrl(p)}) (${isoDate(p.data.date)}): ${p.data.description}`),
    "",
    "## Optional",
    "",
    `- [RSS feed](${SITE}/rss.xml)`,
    `- [Portfolio](${site.url}/)`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
