// Each post as plain Markdown at /<slug>.md, for AI agents and LLM tools
// that read Markdown better than HTML. Linked from the post's <head>.
import type { APIContext } from "astro";
import { getPosts, markdownFor, type Post } from "../lib/posts.ts";

export async function getStaticPaths() {
  const posts = await getPosts();
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}

export function GET({ props }: APIContext<{ post: Post }>) {
  return new Response(markdownFor(props.post), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
