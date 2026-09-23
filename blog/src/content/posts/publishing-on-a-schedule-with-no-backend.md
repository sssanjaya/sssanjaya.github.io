---
title: "Publishing on a schedule with no backend"
description: "How this blog queues posts ahead of time using only a frontmatter date and a daily GitHub Actions cron, with no database or CMS."
date: 2026-09-24
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

## A cron that skips itself

Committing a future-dated file is not enough on its own, because nothing rebuilds the site automatically when that date arrives. The blog's GitHub Actions workflow adds a daily trigger for exactly that:

```yaml
on:
  push:
    branches: ["main"]
    paths: ["blog/**", "src/components/**", ...]
  schedule:
    - cron: "0 11 * * *"
  workflow_dispatch:
```

11:00 UTC was picked as a fixed, unremarkable time of day, not tied to when any particular post should go live. A cron-triggered run doesn't know whether anything is actually due, and rebuilding and redeploying the whole blog every day for nothing is wasteful. So the first step checks before doing any real work:

```yaml
- name: Check for posts due today
  id: due
  run: |
    if [ "$GITHUB_EVENT_NAME" != "schedule" ]; then
      echo "run=true" >> "$GITHUB_OUTPUT"; exit 0
    fi
    today=$(date -u +%F)
    due=$(grep -lE "^date: *['\"]?${today}" blog/src/content/posts/*.md || true)
    if [ -n "$due" ]; then
      echo "Posts due ${today}:"; echo "$due"
      echo "run=true" >> "$GITHUB_OUTPUT"
    else
      echo "No posts dated ${today}. Nothing to publish."
    fi
```

A normal push to `main` always runs the full job, since editing a post or the site itself should deploy right away. On the daily schedule, the step greps every post file for today's UTC date in the frontmatter. If nothing matches, every later step is skipped through an `if: steps.due.outputs.run == 'true'` guard, and the run ends having done nothing but a checkout and a grep. If a post matches, the job installs dependencies, builds, and deploys to Cloudflare Pages exactly as a push would.

That grep is intentionally naive. It does not parse the timestamp form or compare it against the current time, only the date part. A post scheduled for `2026-10-01T13:00:00Z` is treated as due for the whole of October 1st in UTC, and the actual publish moment is whenever that day's 11:00 UTC run happens to land, not the specific hour in the timestamp. Anyone reading the frontmatter closely could be misled by the timestamp form into expecting more precision than the schedule delivers.

## Where this breaks

A few things about this setup only show up at the edges:

- **GitHub pauses scheduled workflows after 60 days of repository inactivity.** A blog that goes quiet for two months needs the cron re-enabled by hand in the Actions tab before the next queued post will go out on time.
- **The comparison is UTC against UTC**, both in the `isScheduled()` check and in the workflow's `date -u +%F`. A post dated `2026-10-01` goes live at the first 11:00 UTC run on or after that date, which is already well into October 1st in every timezone west of UTC.
- **A missed run is not retried.** If the 11:00 UTC run fails or GitHub Actions has an outage, the post simply waits for the next day's run to find it still due, since the grep re-checks every file's date against the current day every time it runs.

None of these are bugs to fix so much as properties to know about before relying on exact timing.

## Why this over a CMS

The alternative would be some system that holds publish state outside the repository: a database, a headless CMS, a serverless function on a timer. Any of those adds a service to run, a credential to protect, and a second source of truth that can drift from what is actually in git. Here, the frontmatter date is the schedule, the grep is the scheduler, and the daily workflow run is the only moving part. Writing a post ahead of time is a commit with a future date; canceling it is deleting that file before the date arrives. Both are ordinary git operations, reviewable in a diff, with no separate system to check.
