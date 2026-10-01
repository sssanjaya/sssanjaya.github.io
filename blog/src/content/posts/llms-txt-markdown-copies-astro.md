---
title: "llms.txt and a Markdown copy of every post in Astro"
description: "How this Astro blog serves /llms.txt, /llms-full.txt, and a noindex Markdown copy of each post, plus JSON-LD that ties every post to one author."
date: 2026-10-02
tags: [astro, static-sites, cloudflare, seo]
takeaways:
  - "An Astro endpoint file such as src/pages/llms.txt.ts renders a plain-text file at build time from the same post list as the HTML pages."
  - "A dynamic endpoint named [slug].md.ts with getStaticPaths writes one Markdown copy per post next to its HTML page."
  - "An X-Robots-Tag: noindex header on /*.md, /llms.txt, and /llms-full.txt keeps the agent copies out of search results without blocking crawlers."
  - "Frontmatter takeaways feed the key takeaways box, the Markdown copy, and the JSON-LD abstract from one source."
  - "Pointing every BlogPosting author at the portfolio's Person @id makes the blog and the portfolio describe one author entity."
---

This blog publishes three extra outputs for AI agents and LLM tools: `/llms.txt`, an index in the [llms.txt](https://llmstxt.org) format; `/llms-full.txt`, every post in one file; and a Markdown copy of each post at `/<slug>.md`. All three are Astro endpoints that build from the same post list as the HTML, so scheduled and draft posts never leak into them. A `noindex` response header keeps the copies out of search, and the HTML pages carry JSON-LD that links each post to one author entity on the portfolio.

Everything below is in `blog/src/pages`, `blog/src/lib/posts.ts`, and `blog/public/_headers`.

## One post list feeds every output

Every page and endpoint calls the same function, `getPosts()` in `blog/src/lib/posts.ts`:

```ts
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection(
    "posts",
    (p) => import.meta.env.DEV || (!p.data.draft && !isScheduled(p)),
  );
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}
```

In a production build it drops drafts and posts dated after build time. Because the agent files use it too, a post queued for next week is missing from `/llms.txt` and has no `.md` copy until the build that publishes its HTML page. The scheduling side is covered in [how this blog publishes on a schedule with no backend](/publishing-on-a-schedule-with-no-backend/).

## Generating /llms.txt with an Astro endpoint

An [Astro endpoint](https://docs.astro.build/en/guides/endpoints/) is a `.ts` file in `src/pages` that exports a `GET` function. In a static build, Astro calls it once and writes the response body to a file whose name is the endpoint's filename minus `.ts`. So `src/pages/llms.txt.ts` becomes `dist/llms.txt`:

```ts
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
```

The structure follows the llms.txt proposal: an H1 with the site name, a blockquote summary, then H2 sections of Markdown links. The section named `## Optional` has a defined meaning in the spec: tools may skip it when they need a shorter context. Each post entry links to the Markdown copy, not the HTML page, so an agent that follows the link gets clean text. The author line reads `name`, `jobTitle`, and `location` from `src/data/site.ts`, the same data the portfolio renders, so the two sites cannot disagree.

`/llms-full.txt` is shorter still. It maps every post through the same `markdownFor()` function the per-post copies use and joins them with a horizontal rule:

```ts
const body = [`# ${blog.title}`, "", `> ${blog.description}`, "", ...posts.map(markdownFor)].join("\n---\n\n");
```

## Writing a Markdown copy of each post with [slug].md.ts

The per-post copies come from a dynamic endpoint, `src/pages/[slug].md.ts`. Like a dynamic page, it exports `getStaticPaths()`, and Astro calls `GET` once per path:

```ts
export async function getStaticPaths() {
  const posts = await getPosts();
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}

export function GET({ props }: APIContext<{ post: Post }>) {
  return new Response(markdownFor(props.post), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
```

The build writes `dist/<slug>.md` beside `dist/<slug>/index.html`. `markdownFor()` puts a header on the raw post body: the title as an H1, the description as a blockquote, a metadata list with the canonical URL, author, dates, and tags, then the takeaways under `## Key takeaways`. The body is `p.body`, the Markdown exactly as written in the source file, with the frontmatter already stripped by the content collection.

Agents find the copy two ways. Each post's `<head>` has an alternate link:

```html
<link rel="alternate" type="text/markdown" title="This post as Markdown" href="/llms-txt-markdown-copies-astro.md" />
```

and the post footer links it for people too ("Also available as Markdown").

## Serving the copies with X-Robots-Tag: noindex

A Markdown copy has the same text as the HTML page. If search engines indexed both, they would compete for the same queries. The blog is on Cloudflare Pages, which reads response headers from a [`_headers` file](https://developers.cloudflare.com/pages/configuration/headers/) in the build output. `blog/public/_headers` has:

```text
# Markdown copies and LLM indexes are for agents. Serve them as text and keep
# them out of search results so they don't compete with the HTML pages.
/*.md
  Content-Type: text/markdown; charset=utf-8
  X-Robots-Tag: noindex

/llms.txt
  X-Robots-Tag: noindex

/llms-full.txt
  X-Robots-Tag: noindex
```

The `headers` passed to `new Response()` in an endpoint apply in the dev server, but a static build writes only the body to disk. What reaches visitors is whatever the host sends, so the `Content-Type` for `.md` files is set again in `_headers`. A request to a live copy confirms both headers:

```bash
curl -sI https://blog.sanjayhona.com.np/hardening-a-static-site.md | grep -iE 'content-type|x-robots'
```

```text
content-type: text/markdown; charset=utf-8
x-robots-tag: noindex
```

The rule is a response header, not a `robots.txt` `Disallow`. A `Disallow` line stops compliant crawlers from fetching the files at all, which would shut out agents too. `robots.txt` stays `Allow: /` and only adds a comment pointing to `/llms.txt`. The sitemap from [@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/) lists only HTML pages, so the `.md` files are not submitted for indexing either. For more on keeping headers in the repo, see [security headers and HSTS preload as code](/security-headers-and-hsts-preload-as-code/).

## Frontmatter takeaways as the JSON-LD abstract

Each post can set `takeaways`, a list of one-sentence answers. The content schema in `blog/src/content.config.ts` limits it to 2 to 5 items:

```ts
takeaways: z.array(z.string()).min(2).max(5).optional(),
```

That one list is used three times: the "key takeaways" box above the post, the `## Key takeaways` section in the Markdown copy, and the `abstract` field of the post's [schema.org `BlogPosting`](https://schema.org/BlogPosting) JSON-LD (JavaScript Object Notation for Linked Data), joined into one string:

```ts
...(takeaways?.length ? { abstract: takeaways.join(" ") } : {}),
```

The same `BlogPosting` node also has an `encoding` entry whose `contentUrl` is the Markdown copy with `encodingFormat: "text/markdown"`, so the structured data points to the plain-text version as well.

## One author entity across two sites with @id

The portfolio at sanjayhona.com.np and the blog at blog.sanjayhona.com.np are separate Astro builds. The portfolio's base layout emits a `Person` node with a fixed `@id`:

```ts
const personId = `${site.url}/#person`;
```

That node carries the name, job title, location, and `sameAs` links to the social profiles. The blog does not repeat all of it. Every `BlogPosting` and the blog index's `Blog` node reference the same `@id`:

```ts
author: { "@type": "Person", "@id": `${site.url}/#person`, name: site.name, url: site.url },
```

In JSON-LD, two nodes with the same `@id` describe the same thing, even on different pages. A parser that reads both sites can merge the blog's author with the portfolio's full `Person` record instead of treating them as two people who share a name. Both sides build the ID from `site.url` in `src/data/site.ts`, so it cannot drift between the sites.

## What each output is for

| Output | Path | Built by | Indexed |
| --- | --- | --- | --- |
| Index of posts | `/llms.txt` | `src/pages/llms.txt.ts` | No (`X-Robots-Tag`) |
| All posts in one file | `/llms-full.txt` | `src/pages/llms-full.txt.ts` | No (`X-Robots-Tag`) |
| One post as Markdown | `/<slug>.md` | `src/pages/[slug].md.ts` | No (`X-Robots-Tag`) |
| Post HTML with JSON-LD | `/<slug>/` | `src/pages/[slug].astro` | Yes, listed in the sitemap |

None of this needs a server. Each file is generated at build time from the content collection and served as a static file, with the indexing rules in one checked-in `_headers` file.
