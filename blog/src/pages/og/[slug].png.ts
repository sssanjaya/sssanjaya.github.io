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
