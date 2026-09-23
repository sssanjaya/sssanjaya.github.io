---
title: "Publishing on a schedule with no backend"
description: "How this blog queues posts ahead of time using only a frontmatter date and a daily GitHub Actions cron, with no database or CMS."
date: 2026-09-23T01:00:00Z
tags: [github-actions, astro, static-sites]
---

A static site has no publish button. There is no database row to flip from draft to live, no cron inside a CMS, nothing running at all between deploys. This blog still needed a way to write a post today and have it go live on a specific day later, without sitting at a keyboard at that exact time. Here is how that works with nothing but a date in the frontmatter and a scheduled workflow.

## The only state is the file

Every post is a Markdown file with a `date` field, validated by the content collection schema:

```ts
schema: z.object({
  title: z.string(),
  description: z.string().max(170),
  date: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
}),
```

`z.coerce.date()` accepts a plain `2026-10-01` or a full timestamp like `2026-10-01T13:00:00Z`. That single field carries all the scheduling information there is. There is no separate `published` flag and no admin panel. If the date is in the future, the post is not out yet.

## Hiding future posts at build time

The filter lives in one function:

```ts
const now = new Date();

export const isScheduled = (p: Post) => p.data.date > now;

export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection(
    "posts",
    (p) => import.meta.env.DEV || (!p.data.draft && !isScheduled(p)),
  );
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}
```

`now` is captured once, at build time, not per request, because there is no request: the HTML is static output. A post with tomorrow's date is excluded from `getPosts()`, so it disappears from the index, its own page, the RSS feed, and the sitemap in that build. In dev (`npm run dev:blog`), the condition short-circuits on `import.meta.env.DEV` and everything shows, scheduled and draft posts included, so they can be previewed before they go out.

This means "unpublished" is really just "not included in this build's output". The file exists in the repository and in git history the whole time. It becomes reachable the moment a build runs after its date.

## A cron that checks the live feed

Committing a future-dated file is not enough on its own, because nothing rebuilds the site when that date arrives. The blog's GitHub Actions workflow adds a daily trigger for exactly that:

```yaml
on:
  push:
    branches: ["main"]
    paths: ["blog/**", "src/components/**", ...]
  schedule:
    - cron: "0 11 * * *"
  workflow_dispatch:
```

11:00 UTC is 7:00 in Ottawa, 6:00 in winter. A cron-triggered run does not know whether anything is due, and redeploying an unchanged blog every day is noise. So the scheduled run builds the blog, then compares the posts in the fresh RSS feed against the posts in the live one:

```yaml
- name: Check for newly due posts
  id: due
  env:
    FEED: https://blog.sanjayhona.com.np/rss.xml
  run: |
    set -o pipefail
    if [ "$GITHUB_EVENT_NAME" != "schedule" ]; then
      echo "run=true" >> "$GITHUB_OUTPUT"; exit 0
    fi
    links() { grep -o '<link>[^<]*</link>' | sort; }
    built=$(links < blog/dist/rss.xml)
    if ! live=$(curl -fsS --retry 3 "$FEED" | links); then
      echo "::warning::Could not fetch $FEED. Deploying to be safe."
      echo "run=true" >> "$GITHUB_OUTPUT"; exit 0
    fi
    if [ "$built" != "$live" ]; then
      echo "Post list changed:"; diff <(echo "$live") <(echo "$built") || true
      echo "run=true" >> "$GITHUB_OUTPUT"
    else
      echo "No newly due posts. Nothing to publish."
    fi
```

A push to `main` always deploys, since editing a post or the site should go out right away. On the schedule, the deploy runs only if the post list changed, and the run logs the diff so you can see which post went out. If the live feed can't be fetched, it deploys anyway: a redundant deploy is cheaper than a missed post.

The first version of this step was simpler. It grepped the frontmatter for today's UTC date and deployed if anything matched. That had two gaps. A failed run on a post's day meant the post never went out, because the next day's grep looked for a different date. And a post with a timestamp later than 11:00 UTC matched the grep, but the build at 11:00 still treated it as future, so it stayed hidden with no later build to publish it. Comparing the build output against the live site fixes both, because it checks whether the site that should exist differs from the site that does.

## Timing rules

- **A post goes live at the first 11:00 UTC run on or after its date and time.** A plain `2026-10-01` means midnight UTC, so it goes out at 11:00 UTC that day. `2026-10-01T13:00:00Z` waits until 11:00 UTC on October 2.
- **Missed runs catch up.** If a run fails or Actions has an outage, the next successful run sees the post missing from the live feed and deploys it.
- **GitHub pauses scheduled workflows after 60 days of repository inactivity.** A blog that goes quiet for two months needs the cron re-enabled in the Actions tab before the next queued post goes out on time.
- **Pushes publish anything already due.** Any push that triggers a deploy also publishes posts whose time has passed, even before 11:00 UTC.

## Why this over a CMS

The alternative would be some system that holds publish state outside the repository: a database, a headless CMS, a serverless function on a timer. Any of those adds a service to run, a credential to protect, and a second source of truth that can drift from what is actually in git. Here, the frontmatter date is the schedule, the daily workflow run is the scheduler, and the live feed is the record of what is out. Writing a post ahead of time is a commit with a future date; canceling it is deleting that file before the date arrives. Both are ordinary git operations, reviewable in a diff, with no separate system to check.
