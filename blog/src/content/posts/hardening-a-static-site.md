---
title: "Hardening a static site: pinned actions, least privilege, and a CSP that can't drift"
description: "A portfolio site has no backend, but its build pipeline and the edge in front of it still deserve a threat model. What I changed and why."
date: 2026-09-22
tags: [security, github-actions, csp, cloudflare]
---

A static site feels like it has nothing to attack. No database, no login, no API. But the site is only the output. The thing worth hardening is the path that produces it and the edge that serves it: a CI job that runs a few hundred npm packages with a token that can publish to production, and a CDN that rewrites the HTML on its way out.

Here is what I changed on [sanjayhona.com.np](https://sanjayhona.com.np) after running a security review over the repo, and the trade-offs behind each change.

## Start with the boring wins

All seven open Dependabot advisories came first, including a critical remote code execution in the framework's image optimizer. None of them were reachable in a static build, but "not reachable today" is not a patch policy. They merged cleanly except one lockfile conflict, which I resolved by regenerating the lockfile with the same npm major that wrote it, then diffing the resolved tree against what Dependabot proposed.

Before merging anything I built the combined result locally and pixel-diffed every page against production. Zero changed pixels meant the upgrade could ship without anyone eyeballing screenshots.

## Pin actions to SHAs, not tags

Tags in a Git repo are mutable. `actions/checkout@v4` means "whatever v4 points to when the job runs". Pinning to a full commit SHA makes the build reproducible and takes tag-moving off the list of ways to get owned:

```yaml
- name: Checkout
  uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    persist-credentials: false
```

The version comment matters. Dependabot's `github-actions` ecosystem reads it and opens PRs that bump both the SHA and the comment, so pinning does not mean freezing.

This also surfaced a quieter problem. Four of the five actions still targeted Node 20, which GitHub removes from runners on 2026-09-23. Runs had been printing deprecation warnings for weeks. Upgrading to the current majors cleared them.

## Give each job only the token it needs

The workflow had `pages: write` and `id-token: write` at the top level, so the build job inherited them. That job runs `npm ci` and the whole build toolchain. If a dependency were ever compromised, it would run with a token that can deploy.

The fix is to default to read-only and grant write access only where it is used:

```yaml
permissions:
  contents: read

jobs:
  build:
    permissions:
      contents: read
      pages: read # configure-pages reads the site config
  deploy:
    permissions:
      pages: write
      id-token: write
```

Two smaller changes go with it:

- `persist-credentials: false` on checkout, so the git token is not sitting in `.git/config` while third-party code runs.
- `npm ci --ignore-scripts`, so dependency lifecycle scripts do not run at all. Only one package in the tree had one, and the build output was byte-identical without it.

## A CSP that can't drift

A Content-Security-Policy on a site with no user input is defense in depth, not a fix for a known bug. The usual objection is maintenance: hash-based policies break silently the moment someone edits an inline script.

The site has exactly one inline script, a few lines that apply the saved theme before first paint. Instead of pasting its hash into config, the layout computes it at build time from the same string it renders:

```ts
import { createHash } from "node:crypto";

export const themeBootstrap = `(function () { /* ... */ })();`;

export const themeBootstrapHash =
  `sha256-${createHash("sha256").update(themeBootstrap).digest("base64")}`;
```

The layout renders `themeBootstrap` and passes `themeBootstrapHash` to the framework's CSP. There is no second copy to forget, so editing the script updates the hash in the same build.

> **Note:** a `<meta>` CSP cannot carry `frame-ancestors`. Clickjacking protection has to be a real response header, which on this setup means the CDN.

## Know what your edge is doing

The most useful finding was not in the repo at all. The site sits behind Cloudflare, and the HTML visitors receive is not the HTML the build produces:

- Rocket Loader rewrote every `<script>` tag so it could defer them. That included the theme bootstrap, which defeats its whole purpose. `data-cfasync="false"` opts it out.
- A Web Analytics beacon was being injected. The footer said "no trackers", which was no longer true. It now says "no cookies", which is.
- Any CSP has to allow what the edge injects, or the edge's own features break without an error you would notice.

I tested the policy against a local copy of the page with the same rewrites applied: Rocket Loader re-typing scripts, the email decoder, and the beacon. Zero violations there, then the same check against the live HTML after deploy.

## What's left

Some fixes cannot live in a repo: response headers at the edge, HSTS preload, DMARC for the domain behind the contact address, and domain verification for the host. They are on a checklist rather than in a pull request, which is the honest place for them.

None of this was hard. Most of it was reading what the pipeline and the CDN actually do instead of what I assumed they did.
