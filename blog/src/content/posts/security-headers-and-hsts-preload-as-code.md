---
title: "Security headers and HSTS preload as code, for a site on GitHub Pages"
description: "GitHub Pages can't set response headers. How this site gets them from a Cloudflare rule and preload-ready HSTS, both kept in the repo and checked after every apply."
date: 2026-09-23T01:05:00Z
tags: [security, cloudflare, github-actions, hsts]
takeaways:
  - "GitHub Pages can't set response headers, so a Cloudflare response header transform rule adds them at the edge."
  - "Cloudflare's phase entry point PUT replaces every rule in the phase, so the script reads, swaps in its own rule by ref, and writes the full list back."
  - "The HSTS preload list requires max-age of at least one year, includeSubDomains, and preload."
  - "Check that every subdomain serves HTTPS before enabling includeSubDomains with preload; removal takes months to reach browsers."
  - "The workflow applies both settings, then verifies the live headers and a clean hstspreload.org result."
---

GitHub Pages serves your files and picks the response headers for you. There is no `_headers` file and no config for it. A `<meta>` Content-Security-Policy covers most of CSP, but it cannot carry `frame-ancestors`, and there is no meta equivalent for `X-Frame-Options`. For those, the header has to be added somewhere between Pages and the browser.

On [sanjayhona.com.np](https://sanjayhona.com.np) that somewhere is Cloudflare, which already proxies the domain. The [hardening post](/hardening-a-static-site/) ended with edge headers and HSTS preload on a checklist, outside the repo. This post covers moving both into the repo: two small Node scripts in `infra/cloudflare/` and one workflow that applies them and then checks the live site.

## What the edge adds

The blog runs on Cloudflare Pages, so it ships its headers in `blog/public/_headers`. The main site needed the same set from a Cloudflare response header rule. The rule is a plain object in `infra/cloudflare/security-headers.mjs`:

```js
// The blog (blog.*) sets its own headers from blog/public/_headers, and www
// redirects to the apex, so the rule only targets the apex host.
export const rule = {
  ref: "site_security_headers",
  description: "Security headers for sanjayhona.com.np (managed in repo: infra/cloudflare)",
  expression: `(http.host eq "${ZONE}")`,
  action: "rewrite",
  action_parameters: {
    headers: {
      "X-Frame-Options": { operation: "set", value: "DENY" },
      // Only frame-ancestors: the full CSP ships as a <meta> tag from the build.
      "Content-Security-Policy": { operation: "set", value: "frame-ancestors 'none'" },
      "Permissions-Policy": { operation: "set", value: "camera=(), microphone=(), geolocation=()" },
      "Referrer-Policy": { operation: "set", value: "strict-origin-when-cross-origin" },
      "X-Content-Type-Options": { operation: "set", value: "nosniff" },
    },
  },
  enabled: true,
};
```

The header CSP holds only `frame-ancestors`. The full policy still comes from the build as a `<meta>` tag, where a hash of the inline theme script is computed from the same string the layout renders.

The five headers now match between the two sites:

| Header | Main site (GitHub Pages) | Blog (Cloudflare Pages) |
|---|---|---|
| `X-Frame-Options: DENY` | Cloudflare rule | `_headers` |
| `Content-Security-Policy: frame-ancestors 'none'` | Cloudflare rule | `_headers` |
| `Permissions-Policy` | Cloudflare rule | `_headers` |
| `Referrer-Policy` | Cloudflare rule | `_headers` |
| `X-Content-Type-Options: nosniff` | Cloudflare rule | `_headers` |

## PUT replaces the whole phase

Cloudflare groups rules into phases, and each zone has one entry point ruleset per phase. The script writes that entry point with a `PUT`, and a `PUT` replaces the entire rule list. Sending only our rule would delete anything else in that phase, including rules someone added in the dashboard.

So the script reads first, swaps in its own rule, and writes everything back:

```js
const current = await cf("GET", `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`);
const others = (current?.rules ?? []).filter((r) => r.ref !== rule.ref).map(writable);
const existing = (current?.rules ?? []).find((r) => r.ref === rule.ref);
const rules = [...others, existing ? { ...rule, id: existing.id } : rule];
```

A few details in those four lines:

- **`ref` is the identity.** The script finds its own rule by `ref`, not by description or position. Editing the rule in the repo updates it in place, and the existing `id` is carried over.
- **Other rules pass through.** `writable` keeps only the fields the `PUT` accepts (`id`, `ref`, `description`, `expression`, `action`, `action_parameters`, `enabled`) and drops read-only ones such as `last_updated`.
- **An empty phase is fine.** The API helper returns `null` for a `404` on a `GET`, so a zone with no entry point yet gives an empty `others` list and the rule is created.
- **Our rule always ends up last.** Existing rules keep their order, and ours is appended after them.

The commit that added the script records tests against a mock of the API. Run against a local mock, an empty phase logs `0 other rule(s) kept, ours created` and writes one rule. A phase holding one foreign rule and an old copy of ours logs `1 other rule(s) kept, ours updated`, writes both, and the foreign rule arrives without `last_updated`.

`--dry-run` prints the ruleset it would write and stops. It still needs a token, because it has to read the zone to know what it would write.

## HSTS, set to the preload minimum

The header rule is one API. HSTS is another. Cloudflare keeps it under the zone's `security_header` setting, and `infra/cloudflare/hsts.mjs` manages only that block:

```js
export const hsts = {
  enabled: true,
  max_age: 31536000, // 1 year, the preload list minimum
  include_subdomains: true,
  preload: true,
  nosniff: true,
};
```

Before this change the zone had `max_age` at 15552000 seconds, six months. According to the commit that added the script, that was the only error [hstspreload.org](https://hstspreload.org/) reported for the domain. The [preload list](https://hstspreload.org/#submission-requirements) requires, among other things, a `max-age` of at least one year, `includeSubDomains`, and `preload`.

The script is idempotent. It reads the current HSTS value, compares each key it manages, and only sends a `PATCH` when something differs:

```js
const current = (await cf("GET", path)).value?.strict_transport_security ?? {};
const same = Object.entries(hsts).every(([k, v]) => current[k] === v);
console.log(`HSTS now: ${JSON.stringify(current)}`);
if (same) return console.log("already at target, nothing to change");
if (DRY) return console.log(`would set: ${JSON.stringify(hsts)}`);
```

Against the mock, the first run moved `max_age` from 15552000 to 31536000, and the second printed `already at target, nothing to change` without writing.

### Check every subdomain before preload

`includeSubDomains` with `preload` is the one setting here that is slow to take back. Once a domain is on the list, browsers force HTTPS for it and every subdomain, and the comment in the script notes that removal takes months to reach browsers. Any subdomain that cannot serve HTTPS becomes unreachable in those browsers.

So the step before setting it was an inventory, recorded in the commit message and the script's header comment: every hostname that had a certificate was checked. The ones that resolve serve HTTPS and redirect HTTP. The others do not resolve at all. That check is a point-in-time fact, dated in the comment. Any new subdomain has to serve HTTPS from its first DNS record.

## Apply, then check the live site

`.github/workflows/edge-headers.yml` runs on a push to `main` that touches `infra/cloudflare/` or the workflow itself, or by hand. It has the same guardrails as the other workflows: SHA-pinned actions, `contents: read`, and `persist-credentials: false` on checkout.

The steps run in this order:

1. **Check credentials.** It uses `CLOUDFLARE_ZONE_TOKEN` if set, else `CLOUDFLARE_API_TOKEN`. With neither, it logs a warning and skips every later step instead of failing.
2. **Apply the header rule** with `security-headers.mjs`.
3. **Apply HSTS** with `hsts.mjs`.
4. **Verify the live headers.** Up to 12 attempts, 10 seconds apart, it sends a `HEAD` request to the apex with a random query string and passes once `X-Frame-Options: DENY`, the `frame-ancestors` CSP, and `Permissions-Policy` all appear.
5. **Verify preload eligibility.** Same loop: it waits for `max-age=31536000` in `Strict-Transport-Security`, then asks the hstspreload.org `preloadable` API for the domain's errors and passes only when there are zero.

Each request adds a random query string to the URL. If either loop runs out after two minutes, the step fails with an `::error::` annotation and prints what it last saw.

Two properties of the job are worth knowing:

- **`concurrency` queues, it does not cancel.** The group is `edge-headers` with `cancel-in-progress: false`, so a second run waits for the first to finish instead of cancelling it.
- **It does not correct drift on its own.** There is no `schedule` trigger. A change made in the Cloudflare dashboard stays until the next push to those paths or a manual run, which puts the repo's rule and HSTS values back.

The preload check had one gap, found while writing this post. The step runs under the default `bash -e` shell, and the hstspreload.org call pipes `curl -f` into `python3`. If that API was down, `python3` failed to parse empty input, the assignment returned non-zero, and the step exited on the first attempt with no error message instead of retrying. The fix is one fallback on the assignment:

```bash
errors=$(curl -fsS "https://hstspreload.org/api/v2/preloadable?domain=sanjayhona.com.np" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['errors']))") || errors="unknown (API call failed)"
```

A failed call now counts as "not yet", the loop retries, and if the API stays down the step ends with the same `::error::` line as any other timeout. Pointed at a closed port locally, the old version exits after one attempt and the new one retries all of them.

## No dependencies

Both scripts use Node's built-in `fetch` and nothing else, so the workflow has no `npm ci` step and no lockfile to trust for this job. Each one exits non-zero with an `::error::` line on any failed API call, and both stop before writing if the token is missing or cannot see the zone.

The headers the main site sends now live in a reviewed diff, get applied by a pinned workflow, and are checked against the live domain on every change. The dashboard is no longer the source of truth for them.
