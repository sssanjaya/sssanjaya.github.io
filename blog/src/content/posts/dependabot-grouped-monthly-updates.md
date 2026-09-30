---
title: "dependabot.yml groups: monthly PRs, instant security fixes"
description: "A dependabot.yml that sends one grouped npm PR and one GitHub Actions PR a month, while Dependabot security updates still open their own PRs right away."
date: 2026-10-01
tags: [dependabot, github-actions, npm, security, ci]
takeaways:
  - "Dependabot security updates need no dependabot.yml; they are a repository setting and open one pull request per vulnerable package."
  - "A group in dependabot.yml applies to version updates only unless it sets applies-to: security-updates, so grouping monthly bumps does not delay security fixes."
  - "Grouping npm updates by update-types minor and patch leaves every major version bump in its own pull request."
  - "Dependabot keeps SHA-pinned GitHub Actions current when each pin carries a trailing version comment such as # v7.0.1."
  - "Dependabot only updates versions it can parse from a manifest or a uses: line, so a version string inside a shell command needs a manual bump."
---

To get Dependabot without a stream of single-package pull requests (PRs), split its two jobs. Leave security updates on in the repository settings, where they open a PR as soon as a fix exists. Then add a `.github/dependabot.yml` that runs version updates monthly and groups them: one PR for npm minor and patch bumps, one for GitHub Actions, and majors on their own.

This site runs exactly that. Here is the file, what each key does, and what changed in the PR history once it landed.

## The dependabot.yml for this repo

```yaml
# Version updates. Security updates are enabled separately in repo settings
# and still open their own PRs immediately.
version: 2
updates:
  # Keeps the SHA-pinned actions in .github/workflows current.
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    groups:
      actions:
        patterns: ["*"]

  # One grouped PR a month for minor/patch npm updates; majors come alone.
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: monthly
    groups:
      npm-minor-patch:
        update-types: ["minor", "patch"]
```

It is 21 lines, and it only configures version updates. Security updates are not in it at all.

## Security updates vs version updates in Dependabot

[Dependabot](https://docs.github.com/en/code-security/dependabot) has two update types that are easy to conflate:

| | Security updates | Version updates |
|---|---|---|
| Turned on by | Repository settings | `.github/dependabot.yml` |
| Trigger | A Dependabot alert with a patched version available | The `schedule.interval` in the config |
| PRs in this repo | One per vulnerable dependency | One per group, majors separate |
| Affected by `groups` here | No | Yes |

[Security updates](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates) work without any config file. Version updates only run for the ecosystems listed under `updates`.

The key detail is how `groups` interacts with the two. In the [Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference), a group has an `applies-to` key that defaults to `version-updates`. Neither group here sets it. So the grouping and the monthly schedule shape version updates only, and a security fix still arrives as its own PR without waiting for the monthly run. That is what the comment at the top of the file says.

## What the repo looked like before the config

Before 2026-09-22 the repo had no `dependabot.yml`, so every Dependabot PR was a security update. They arrived one package at a time. The seven merged on 2026-09-22 were separate PRs for svgo, smol-toml, sharp, js-yaml, devalue, nanoid, and astro, with commits dated from 2026-09-09 to 2026-09-22.

Seven PRs against one `package-lock.json` also means seven chances to conflict. The astro PR did: by the time it was ready, six other bumps had rewritten the lockfile underneath it. [Fixing package-lock.json churn between npm 10 and npm 11](/package-lock-churn-npm-versions/) walks through that merge.

Those PRs were fixes, so one PR each is the right shape for them. The noise problem is routine version bumps arriving the same way.

## Grouping npm minor and patch updates into one PR

```yaml
groups:
  npm-minor-patch:
    update-types: ["minor", "patch"]
```

`update-types` filters by semantic version level. Any update that is a minor or patch bump joins the `npm-minor-patch` group. A major bump matches no group, so Dependabot opens it as a normal single-dependency PR. That keeps a breaking release out of the batch, where it would block every harmless patch next to it.

The config merged to `main` at 21:02 UTC on 2026-09-22. Dependabot's first grouped commit is timestamped 21:47 UTC the same day:

```text
Bump the npm-minor-patch group across 1 directory with 4 updates
```

It updated four packages in one PR:

| Package | From | To | Level |
|---|---|---|---|
| `@astrojs/sitemap` | 3.7.3 | 3.7.4 | patch |
| `@fontsource/ibm-plex-sans` | 5.2.8 | 5.3.0 | minor |
| `@fontsource/jetbrains-mono` | 5.2.8 | 5.3.0 | minor |
| `astro` | 7.2.8 | 7.3.3 | minor |

The commit touched only `package.json` and `package-lock.json`. Each entry in its `updated-dependencies` trailer carries `dependency-group: npm-minor-patch`, and the branch was named `dependabot/npm_and_yarn/npm-minor-patch-4c4cb39b24`. Four version bumps took one review and one merge.

## One directory covers the site and the blog

Both ecosystems use `directory: /`. That works because this repo has a single `package.json` and `package-lock.json` at the root. The blog is not a separate package. It builds from the same dependencies with `astro build --root blog`:

```json
"build": "astro build",
"build:blog": "astro build --root blog"
```

If the blog had its own `package.json` under `blog/`, Dependabot would not see it without a second `npm` entry for that directory, or a `directories` list.

## Keeping SHA-pinned GitHub Actions updated

Every action in the three workflows is pinned to a full commit SHA with the version as a trailing comment:

```yaml
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

The `github-actions` ecosystem updates these pins. When a new release comes out, the PR changes the SHA and the `# v7.0.1` comment together, so the comment stays an accurate label for the pin. Without the comment, a reviewer sees only one 40-character hex string replacing another.

The `actions` group uses `patterns: ["*"]`, which matches every action. There is no `update-types` filter, so majors join the group too. With five actions across three workflows, all from the `actions` organization, one PR a month is the whole update load.

Pinning to the wrong SHA is its own failure mode. [Pinning a GitHub Action to a tag object instead of its commit](/pinning-actions-tag-object-vs-commit/) covers how to resolve a tag to the commit it points at, and [Hardening a static site](/hardening-a-static-site/) covers why the pins are there.

## What Dependabot does not update here

Dependabot updates versions it can parse: dependencies in `package.json` for npm, and `uses:` references for GitHub Actions. The blog deploy step in `.github/workflows/blog.yml` pins its CLI a different way:

```yaml
env:
  WRANGLER: wrangler@4.136.3
```

The step then runs `npx --yes "$WRANGLER" pages deploy ...`. That version lives in an environment variable in a shell step. It is not a `uses:` line and it is not in `package.json`, so neither ecosystem in this config reads it. It stays pinned until someone bumps it by hand.

## When the monthly schedule runs

`interval: monthly` runs on the first day of each month. Version updates for both ecosystems therefore land together at the start of the month, and nothing routine arrives in between. Security updates ignore that schedule.

The trade-off is that a minor release can sit for up to a month before its PR shows up. Anything that is a security fix still comes through a security update, and anything else urgent can be bumped by hand.
