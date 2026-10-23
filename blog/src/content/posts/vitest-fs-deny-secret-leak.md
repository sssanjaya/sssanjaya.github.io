---
title: "CVE-2026-112948: Vitest Dev Server Leaks .env and Token"
description: "Vitest 5.0.0-beta.6 to 5.0.4 misapplies server.fs.deny, so the UI, Browser Mode, and API servers hand out .env and the API token. Upgrade to 5.0.5."
date: 2026-10-23T10:20:00Z
tags: [security, ai-security, typescript, devsecops]
takeaways:
  - "CVE-2026-112948 lets anyone who can reach a Vitest 5 dev server read files Vite blocks by default, plus Vitest's own API token file."
  - "Running vitest or vitest run opens no port and is not affected; only --ui, Browser Mode, or the api option start the vulnerable server."
  - "The root server serves .vitest-secret-token because Vitest pushes the entry onto fs.deny after Vite has already compiled its matcher."
  - "The Browser Mode project server serves .env because a config hook replaces Vite's default deny list with a one-entry list."
  - "Upgrade vitest, @vitest/ui, @vitest/browser, or vite-plus to 5.0.5 or 1.3.0; a GET of the token file then returns 403 instead of the secret."
---

Run Vitest 5.0.4 with `--api` and this one line reads its secret API token over plain HTTP: `curl -s localhost:51204/node_modules/.vitest/.vitest-secret-token?raw` returns `"13ba4d82-551a-49ec-b7e4-f878226fedcb"`. [GHSA-p458-7748-mcp3](https://github.com/vitest-dev/vitest/security/advisories/GHSA-p458-7748-mcp3) (CVE-2026-112948, published 2026-10-20) covers this in Vitest 5.0.0-beta.6 through 5.0.4: the dev server misapplies `server.fs.deny` and hands out `.env`, private keys, `.git`, and that token. Upgrade to 5.0.5.

<figure>
  <img src="/diagrams/vitest-fs-deny-secret-leak-matrix.svg" alt="Table of three Vitest setups. Plain vitest run opens no server. The root server (--ui or --api) denies .env with a 403 but serves the API token file with a 200. Browser Mode with test.projects serves .env from its project server and denies the token. The two served cells are the leaks." width="900" height="560" loading="lazy" />
  <figcaption>Which server leaks which file in Vitest 5.0.0-beta.6 to 5.0.4. Red cells are served to any caller that reaches the port.</figcaption>
</figure>

## What the advisory covers

The flaw is CWE-200 and CWE-552, information disclosure from Vitest's dev servers. GitHub and the CVE record (issued by GitHub's CNA) both rate it Medium, CVSS 3.1 score 6.5, vector `AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:N/A:N`. The advisory's summary states the scope:

> In Vitest 5, Vite's `server.fs.deny` is not applied as intended on Vitest's dev servers. Depending on the server, files that Vite refuses to serve by default (such as `.env`, private keys and certificates, `.npmrc`, and `.git`) or Vitest's own API token file (`.vitest-secret-token`) can be read over plain HTTP by a client that can reach the server.

The important limit is in the next lines. A plain test run is safe:

> This only applies when Vitest runs an HTTP server, which happens with the UI (`--ui`), Browser Mode, or `api` enabled. Plain `vitest` and `vitest run` don't listen on any port and are not affected.

Vitest 4 and earlier are unaffected. They do not persist an API token and do not override `server.fs.deny`.

## Why the deny list went missing

Vite builds its file protection once. It applies its default deny list only when `server.fs.deny` is unset, and it compiles that list into a matcher during config resolution. Later edits to the array do nothing. Vitest 5 trips over both rules, in two different ways.

<figure>
  <img src="/diagrams/vitest-fs-deny-secret-leak-rootcause.svg" alt="Two lanes. In the root server lane, Vite compiles its deny matcher during config resolution, then Vitest runs fs.deny.push for the token afterward, so the token is never matched and GET token?raw returns 200. In the project server lane, a config hook returns deny set to only the token, which replaces Vite's default list, so .env is no longer denied and is served as text/javascript." width="900" height="540" loading="lazy" />
  <figcaption>The root server adds the token entry too late; the project server replaces the defaults. Both end with a file that should be blocked being served.</figcaption>
</figure>

On the root server, the token entry arrives after the matcher is built. In the 5.0.4 build the push is literal:

```js
rootViteConfig.server.fs.deny.push(API_TOKEN_FILE);
```

Vite has already compiled `server.fs.deny` into `fsDenyGlob` by then, so the new entry never joins the matcher. Vite's own defaults still protect `.env` and keys here, but the token file in `node_modules/.vitest` sits inside the serving root, and nothing denies it.

On the project server that Browser Mode starts with `test.projects`, a `config()` hook returns its own deny list:

```js
server: {
  fs: {
    allow: globalViteConfig.server.fs.allow,
    deny: [API_TOKEN_FILE]
  }
}
```

That array replaces Vite's defaults rather than extending them. Now the deny list holds only the token, and `.env`, keys, and `.git` fall through.

## The token is the prize

The token is not a nuisance file. It authenticates the Vitest UI, the `/__vitest_attachment__` route, and the API WebSocket. The advisory spells out what that RPC can do:

> whose RPC can write and rerun test files when `api.allowWrite`/`api.allowExec` are enabled.

So read access to one file in `node_modules/.vitest` can become code execution on the developer's machine when those options are on.

The token normally lives in the per-user data directory, outside the serving root, where it is safe. It falls into the servable `node_modules/.vitest` location only when the data directory cannot be written. The advisory names the exact case:

> When that directory can't be written, for example in a container whose user has no writable `HOME`, Vitest falls back to `<workspaceRoot>/node_modules/.vitest/.vitest-secret-token`, which the root server then serves.

CI containers and dev containers are where `HOME` is often read-only, which is where the fallback, and the leak, are most likely.

## Reproducing the token leak

Running the vulnerable version against a throwaway project shows it directly. Installing Vitest 5.0.4 and starting the API server over a non-writable `HOME` forces the fallback token path, then a single request reads it.

```console
$ npm i -D vitest@5.0.4 vite@8.3.5
$ HOME=/dev/null node_modules/.bin/vitest --watch --api.port 51204
 RUN  v5.0.4
      API started at http://localhost:51204/

$ curl -s "http://localhost:51204/node_modules/.vitest/.vitest-secret-token?raw"
const __vite_ssr_export_default__ = "13ba4d82-551a-49ec-b7e4-f878226fedcb\n"
```

The server returns the token with `content-type: text/javascript`. The same request for `.env` on this root server returns `403 Restricted`, because Vite's defaults still cover it there. The dangerous file on the root server is the token.

Upgrading one package closes it. On Vitest 5.0.5 the request is refused:

<figure>
  <img src="/diagrams/vitest-fs-deny-secret-leak-fix.svg" alt="Two terminal panels. On Vitest 5.0.4 a GET of the API token file over the dev server returns HTTP 200 with the secret token 13ba4d82. On Vitest 5.0.5 the same request returns HTTP 403 Restricted and the token stays secret." width="900" height="440" loading="lazy" />
  <figcaption>Before and after the fix. Running the same curl against 5.0.4 returns the token; against 5.0.5 it returns 403.</figcaption>
</figure>

```console
$ npm i -D vitest@5.0.5
$ HOME=/dev/null node_modules/.bin/vitest --watch --api.port 51205
$ curl -s "http://localhost:51205/node_modules/.vitest/.vitest-secret-token?raw"
<h1>403 Restricted</h1>
<p>The request ...is outside of Vite serving allow list.</p>
```

The fix shipped in [v5.0.5](https://github.com/vitest-dev/vitest/releases/tag/v5.0.5) as pull request #11578, "Keep vite default `fs.deny` with api token file". The release note carries that one line and nothing else about the change.

## The .env vector needs a browser

The project-server leak is worse to read about and narrower to hit. Per the advisory, while Browser Mode with `test.projects` is running, a page the developer visits can pull `.env` through a classic script tag:

> any page the developer visits can read `.env` values that are valid JavaScript, through a classic `<script>` include. This works when the file consists of `KEY="value"` lines.

The file is served as `text/javascript`, so each `KEY="value"` line runs as a global assignment the page can read back. The limits are real and worth knowing. An unquoted value throws and stops the script at that line. A `#` comment or an `export` prefix anywhere in the file is a syntax error that stops the whole script. `fetch` and cross-site XHR stay blocked by Vite's CORS policy, though that policy allows other localhost origins, so a second local dev server can read full files. Recent Chrome may prompt for Local Network Access first.

## What to do

1. Find affected installs. Run `npm ls vitest @vitest/ui @vitest/browser vite-plus` and flag any `vitest`, `@vitest/ui`, or `@vitest/browser` in the range 5.0.0-beta.6 to 5.0.4, or `vite-plus` from 1.0.0-rc.0 to 1.2.x.
2. Upgrade. Move `vitest` to 5.0.5 or later, or `vite-plus` to 1.3.0 or later. `@vitest/ui` and `@vitest/browser` pin `vitest` as a peer, so bumping either one pulls the patched `vitest` too.
3. If you cannot upgrade now, set `server.fs.deny` explicitly in the root Vitest config, including Vite's default list for your Vite version plus `.vitest-secret-token`. The advisory gives the full list for Vite 8.3.
4. Rotate anything a dev server may have exposed. Treat `.env` secrets and the Vitest API token as burned on any machine that ran `--ui`, Browser Mode, or `api` on an affected version and was reachable by another local process or the network.
5. Keep the UI and API off shared hosts. Do not set `api.host` or `browser.api.host`, forward the port, or publish it from a container unless you mean to expose the dev server.

This is a dev-tooling leak, not a production one. The advisory is clear that applications built or deployed from the project are not affected, only the machine running Vitest while one of these servers is up. For another recent case of test and server tooling leaking state it should have kept apart, see [the MCP TypeScript SDK sending one client's results to another](/mcp-sdk-shared-server-leak/).
