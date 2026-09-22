import { getCollection, type CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"posts">;

export const blog = {
  title: "Sanjay Hona — Blog",
  description:
    "Field notes from production: incident write-ups, runbooks, and what I learn running cloud and edge infrastructure.",
};

// Nav for the top bar and command palette.
export const blogNav = [
  { label: "posts", href: "/" },
  { label: "tags", href: "/tags/" },
  { label: "rss", href: "/rss.xml" },
  { label: "sanjayhona.com.np", href: "https://sanjayhona.com.np/" },
] as const;

/** Published posts, newest first. Drafts are included only in dev. */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection("posts", (p) => import.meta.env.DEV || !p.data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export const readingTime = (body = "") =>
  Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 220));

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export const tagSlug = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
