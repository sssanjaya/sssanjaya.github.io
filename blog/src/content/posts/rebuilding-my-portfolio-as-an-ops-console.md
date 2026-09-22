---
title: "Rebuilding my portfolio as an ops console, and hosting it for $0"
description: "How I redesigned sanjayhona.com.np around SRE ideas, and how two static sites share one repo across GitHub Pages and Cloudflare Pages."
date: 2026-09-22
tags: [astro, static-sites, github-pages, cloudflare, design]
---

My old portfolio was a clean code-editor theme with a sidebar. It was fine, and it said nothing about the work I do. I run production systems, so I rebuilt the site to look and behave like the tools I use every day: a status page, dashboards, a deploy log.

This post covers the design, how the site is built, and how it and this blog are hosted without a server or a bill.

## The design: use the job as the metaphor

Every section maps to something an SRE already reads daily:

| Section | Borrowed from |
|---|---|
| Hero | A terminal running `kubectl get engineer` and `kubectl describe` |
| Career numbers | Grafana stat panels: MTTR, release frequency, fleet size |
| Skills | A status page, one cell per quarter, with AIOps shown as a canary |
| Experience | A deploy history: the current role is `running`, past roles `exit 0` |
| Stack | A platform diagram: delivery, runtime, and cloud, with security and observability wired through every layer |
| Contact | An escalation policy: L1 email, L2 LinkedIn |

A few rules kept it honest:

- **Colors mean something.** Green is healthy, amber is in progress, red is failure. Nothing uses a color just to look nice.
- **Every number is real.** The panels show before and after values from actual work, like environment setup going from 3+ days to under 2 hours. No sparklines of made-up data.
- **Dark by default**, with a light theme one toggle away, and every text color checked against WCAG AA contrast in both.
- **Keyboard first.** Press `/` or `⌘K` anywhere for a command palette that jumps between sections, copies my email, or switches theme.

## Keep all the content in two files

The site is [Astro](https://astro.build) with no client framework. About 4 KB of JavaScript handles the theme toggle, the local clock, and the palette. Everything else is static HTML and CSS.

All copy lives in two TypeScript files: one for identity, signals, status rows, and stack, and one for roles. The components only read from them. Updating the site means editing data, not markup:

```ts
status: [
  { name: "DevOps", since: 2019, state: "operational" },
  { name: "SRE", since: 2025, state: "operational" },
  { name: "AIOps", since: 2026, state: "canary" },
],
```

Some values are computed at build time: the quarter grid on the status page, the terminal's `AGE` column, and the commit hash in the footer. Every deploy refreshes them, so the page never shows a stale "updated" date longer than the gap between deploys.

## Hosting: two static sites, one repo, $0

Here is the whole setup:

```text
┌────────────────────── one GitHub repo ──────────────────────┐
│  src/   main site ┐                                         │
│  blog/  blog      ┴─ share layout, styles, CSP, components  │
└───────────┬──────────────────────────────────┬──────────────┘
            │ push to main                     │ push to main,
            │                                  │ blog/ or src/ changed
            ▼                                  ▼
  Actions: static.yml                Actions: blog.yml
  npm ci, astro build                npm ci, astro build --root blog
            │                                  │
            ▼                                  ▼
  GitHub Pages                       Cloudflare Pages
  behind Cloudflare proxy                      │
            │                                  │
            ▼                                  ▼
  sanjayhona.com.np                  blog.sanjayhona.com.np
```

### Why two hosts

GitHub Pages allows one custom domain per repository. The main site already uses it, so `blog.sanjayhona.com.np` cannot come from the same Pages deployment. I had three options:

1. Put the blog at `/blog` on the main site. Simple, but I wanted the subdomain.
2. Create a second repo for the blog. That means copying the design and watching the two drift apart.
3. Keep the blog in the same repo and deploy it somewhere else.

I picked the third. The blog is a second Astro project in `blog/`, built with `astro build --root blog`. It imports the main site's layout, top bar, command palette, and styles straight from `src/`. One design, two outputs.

Cloudflare Pages hosts the blog. The domain's DNS is already on Cloudflare, so attaching the subdomain is one click, and Pages supports a `_headers` file. That matters more than it sounds.

### What the host decides for you

A static host is also your security boundary, because it controls the response headers:

| | GitHub Pages | Cloudflare Pages |
|---|---|---|
| Custom domains per project | 1 | Many |
| Custom response headers | No | Yes, via `_headers` |
| Deploy from | Actions artifact or branch | Direct upload via Wrangler, or Git |
| Cost for a personal site | Free | Free |

On GitHub Pages, the only way to add a Content-Security-Policy is a `<meta>` tag, and a meta tag cannot carry `frame-ancestors` or `X-Frame-Options`. On Cloudflare Pages, the blog ships a real header file:

```text
/*
  X-Frame-Options: DENY
  Content-Security-Policy: frame-ancestors 'none'
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

For the main site, those headers have to be added at the Cloudflare proxy in front of GitHub Pages instead.

### Two pipelines, same guardrails

Both workflows follow the same rules:

- Actions pinned to full commit SHAs, updated by Dependabot.
- A read-only `GITHUB_TOKEN`. Only the deploy step gets credentials that can publish.
- `npm ci --ignore-scripts`, so dependency install scripts never run.
- The blog workflow only runs when `blog/` or the shared `src/` files change, and it skips the deploy with a warning if the Cloudflare secrets are missing, instead of failing.

## How I shipped it without breaking anything

A redesign plus seven dependency upgrades is a lot of change for a site people actually visit. What made it safe was checking outputs, not eyeballing screenshots:

- **Pixel diffs.** Before merging the dependency upgrades, I built the site with old and new versions and compared screenshots across desktop, mobile, dark, and light. Zero differing pixels meant the upgrade changed nothing visible.
- **Byte-identical builds.** Moving shared code into modules for the blog was a refactor, so the main site's HTML had to come out identical. It did, after I fixed one stray trailing space.
- **Browser tests.** A small Playwright suite checks the palette, keyboard shortcuts, theme persistence, copy-to-clipboard, the 404 page, and that no page scrolls sideways on a phone. It caught a code block overflowing on mobile before this post shipped.
- **Test the edge too.** Cloudflare rewrites the HTML on the way out. I tested the security policy against a copy of the page with the same rewrites applied, then against the live HTML after deploy.

## What it costs

Nothing. GitHub Pages, Cloudflare Pages, Cloudflare DNS, and GitHub Actions minutes for a public repo are all free at this scale. The only paid piece is the domain.

The source is public at [github.com/sssanjaya/sssanjaya.github.io](https://github.com/sssanjaya/sssanjaya.github.io). If you run production systems, your portfolio can look like it.
