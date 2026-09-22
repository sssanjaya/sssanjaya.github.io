import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { blog, getPosts } from "../lib/posts.ts";

export async function GET(context: APIContext) {
  const posts = await getPosts();
  return rss({
    title: blog.title,
    description: blog.description,
    site: context.site!,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.date,
      link: `/${p.id}/`,
      categories: p.data.tags,
    })),
  });
}
