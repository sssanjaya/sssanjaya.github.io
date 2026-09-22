# sanjayhona.com.np

Personal site of **Sanjay Hona**, Site Reliability Engineer in Ottawa.

The site is built like an ops console: a status page, golden-signal panels, a deploy history, and a platform topology. Every number and date on it comes from real work history, not sample data.

**Live:** https://sanjayhona.com.np

![Social preview of the site](public/og.png)

## What's on the page

| Section | What it shows |
|---|---|
| Hero | Name, role, and a terminal that runs `kubectl get` / `kubectl describe` against the "currently" data |
| Golden signals | Career metrics as dashboard panels: years in production, edge fleet size, MTTR, release frequency, env setup time, audit findings |
| Service status | Each discipline tracked like a service, one cell per quarter since 2016 |
| Deploy history | Roles, newest first. The current role is `running`, past roles `exit 0` |
| Platform stack | Delivery → runtime → cloud, with security and observability as cross-cutting layers |
| About | Short README plus operating principles |
| Contact | Escalation policy: email first, LinkedIn second |

Press `/` or `⌘K` (`Ctrl K` on Windows/Linux) anywhere to open the command palette.

## Stack

- [Astro](https://astro.build) 7, static output, no client framework
- Plain CSS with design tokens; dark theme by default, light theme on toggle
- Self-hosted fonts via [Fontsource](https://fontsource.org): Space Grotesk, IBM Plex Sans, JetBrains Mono
- About 4 KB of client JavaScript: theme toggle, local clock, command palette
- Hosted on GitHub Pages, deployed by GitHub Actions
- No trackers, no cookies, no third-party requests at runtime

## Edit the content

All copy and data live in two files. Components read from them, so most edits need no component changes.

| File | Controls |
|---|---|
| [`src/data/site.ts`](src/data/site.ts) | Name, contact, nav, signal panels, status rows, stack topology, principles, "currently" block |
| [`src/data/experience.ts`](src/data/experience.ts) | Roles, blurbs, impact chips, tags |

Hero and About prose live in [`src/components/Hero.astro`](src/components/Hero.astro) and [`src/components/About.astro`](src/components/About.astro).

## Run it locally

Requires Node 22 (same as CI).

```bash
npm ci
npm run dev       # http://localhost:4321
npm run build     # static output in dist/
npm run preview   # serve dist/
```

## Project layout

```text
src/
  components/   one file per section, plus TopBar, CommandPalette, SectionHead
  data/         site.ts and experience.ts (all content)
  layouts/      Base.astro: meta tags, JSON-LD, theme bootstrap
  pages/        index.astro and 404.astro
  scripts/      console.ts: theme, clock, nav highlight, palette, copy
  styles/       global.css: design tokens and shared primitives
public/         favicon, OG image, CNAME, robots.txt, web manifest
```

## Deploy

Every push to `main` runs [`.github/workflows/static.yml`](.github/workflows/static.yml), which builds the site and publishes `dist/` to GitHub Pages. The custom domain comes from [`public/CNAME`](public/CNAME).

A few values are set at build time and refresh on each deploy: the commit hash in the footer, the status page's "updated" date and quarter cells, and the terminal's `AGE` column.

To roll back, revert the commit on `main`. The next deploy publishes the previous version.

## Dependencies and security

- Dependabot opens PRs for vulnerable npm packages. Run `npm audit` to check the current state locally.
- The build output is plain static files. There is no backend, no secrets in the build, and no user input stored anywhere.

## Contact

devops@sanjayhona.com.np · [LinkedIn](https://linkedin.com/in/sanjayhona)
