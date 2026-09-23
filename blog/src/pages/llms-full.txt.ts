// /llms-full.txt: every published post as Markdown in one file, newest first.
import { blog, getPosts, markdownFor } from "../lib/posts.ts";

export async function GET() {
  const posts = await getPosts();
  const body = [`# ${blog.title}`, "", `> ${blog.description}`, "", ...posts.map(markdownFor)].join("\n---\n\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
