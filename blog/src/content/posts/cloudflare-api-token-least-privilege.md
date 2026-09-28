---
title: "Least-privilege Cloudflare API tokens, one error at a time"
description: "A Cloudflare API 403 \"Authentication error\" or error 9109 means the token lacks a scope. Add Zone permissions one at a time, not an all-zones admin token."
date: 2026-09-29
tags: [cloudflare, security, github-actions]
takeaways:
  - "Start a Cloudflare API token with the fewest permissions you can name, and add a scope only when a real call fails without it."
  - "The edge-headers job needed Zone > Transform Rules > Edit for the rulesets API and Zone > Zone Settings > Edit for the HSTS setting."
  - "A script that prints the HTTP status, Cloudflare error code, and request path turns each permission failure into a precise next step."
  - "A dry run that only reads cannot prove a token can write, so the first real apply is the permission test."
  - "Write the required permissions next to the code that needs them, in the workflow header and the script's env comment."
---

The workflow that sets this site's security headers through the Cloudflare application programming interface (API) was missing permissions twice. Its token first got a 403 `Authentication error` on the rulesets API, fixed by adding Zone > Transform Rules > Edit. When the job later took on HSTS (HTTP Strict Transport Security), it got error `9109` on the HSTS setting, fixed by adding Zone > Zone Settings > Edit. Starting from a narrow token and letting each failure name the next scope gave a token that can do exactly what the job does, and nothing close to an all-zones admin token.

The job itself is covered in [security headers and HSTS preload as code](/security-headers-and-hsts-preload-as-code/). This post is about the token it runs with.

## What the job calls, and the permission each call needs

`.github/workflows/edge-headers.yml` runs two Node scripts from `infra/cloudflare/`. Between them they make five kinds of API call:

| Call | Script | Token permission that covers it |
|---|---|---|
| `GET /zones?name=sanjayhona.com.np` | both | Zone > Zone > Read |
| `GET .../rulesets/phases/http_response_headers_transform/entrypoint` | `security-headers.mjs` | Zone > Transform Rules > Edit |
| `PUT .../rulesets/phases/http_response_headers_transform/entrypoint` | `security-headers.mjs` | Zone > Transform Rules > Edit |
| `GET .../settings/security_header` | `hsts.mjs` | Zone > Zone Settings > Edit |
| `PATCH .../settings/security_header` | `hsts.mjs` | Zone > Zone Settings > Edit |

The workflow header lists the result, so the next person to rotate the token does not have to rediscover it:

```yaml
# Token: CLOUDFLARE_ZONE_TOKEN if set, else CLOUDFLARE_API_TOKEN. Either needs
# Zone > Zone > Read, Zone > Transform Rules > Edit, and Zone > Zone Settings >
# Edit on sanjayhona.com.np.
```

The last column is the permission in this job's token that covers each call, not the narrowest one that could. All three are zone permissions, scoped to one zone. None of them is an account permission. Cloudflare's [API token permissions reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) lists every group, and [Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) shows how to limit a token to specific zones.

## Why start narrow instead of with an admin token

A token with every permission on every zone works on the first try. It also means that anything able to read the secret can change Domain Name System (DNS) records, turn off the proxy, or edit any other zone on the account. In this repo that secret is read by a workflow step on GitHub Actions, so its reach is whatever the token allows.

Starting narrow costs a few failed runs. Each failure is cheap here, because each script stops on its first error and makes no call after it. Adding a scope later is a small edit to the token in the dashboard.

## Reading the error Cloudflare returns

Both scripts wrap `fetch` in the same helper. On any non-2xx response, or a body with `success: false`, it throws with the method, the path, the response status, and every Cloudflare error code and message:

```js
const json = await res.json().catch(() => ({}));
if (!res.ok || json.success === false) {
  const msg = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ") || res.statusText;
  throw new Error(`${method} ${path} -> ${res.status} ${msg}`);
}
```

`main()` catches that, prints it as `::error::` so GitHub Actions shows it as an annotation, and exits 1. Against a local mock that answers the rulesets call with a 403, `security-headers.mjs` prints:

```text
::error::GET /zones/z1/rulesets/phases/http_response_headers_transform/entrypoint -> 403 10000: Authentication error
```

The message alone says little. The path says which API refused, and the API tells you which permission group to open. `rulesets/phases/http_response_headers_transform` belongs to [Transform Rules](https://developers.cloudflare.com/rules/transform/). `settings/security_header` is the zone setting behind [HSTS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/), which falls under Zone Settings.

`security-headers.mjs` treats a `404` on a `GET` as "no entry point yet" and returns `null`, so a zone with no rules in that phase works. A `403` is not a `404`, so a missing permission still throws instead of being read as an empty phase.

There is one more failure mode with no error code at all. If the token cannot see the zone, the zone lookup returns an empty list, and both scripts stop with their own message:

```text
zone sanjayhona.com.np not visible to this token
```

That points at Zone > Zone > Read, or at a token scoped to a different zone.

## Why the errors arrive one per run

The workflow runs the two scripts as separate steps:

```yaml
- name: Apply header rule
  if: steps.cf.outputs.ready == 'true'
  ...
  run: node infra/cloudflare/security-headers.mjs
- name: Apply HSTS
  if: steps.cf.outputs.ready == 'true'
  ...
  run: node infra/cloudflare/hsts.mjs
```

An `if:` without a status function gets an implicit `success()`, as the [GitHub Actions expressions docs](https://docs.github.com/en/actions/learn-github-actions/expressions#status-check-functions) describe. So when the header rule step fails, the HSTS step is skipped. You fix one permission, rerun, and the next missing one shows up. Within a script it is the same: the first failed call throws, and nothing after it runs.

That is slower than seeing every gap at once. A run can still apply the header rule and then fail on HSTS. Rerunning is safe: the header rule is matched by its `ref` and replaced in place, and `hsts.mjs` only sends a `PATCH` when the live value differs.

## A dry run does not test write permission

Both scripts take `--dry-run`. It still calls the API, but only to read:

- `security-headers.mjs --dry-run` looks up the zone, reads the phase entry point, prints the rules it would `PUT`, and stops.
- `hsts.mjs --dry-run` looks up the zone, reads `security_header`, prints `would set: ...`, and stops.

Against the same mock, with the `PATCH` answered by a 403 `9109`, the dry run printed the planned HSTS value and exited 0. The real run printed:

```text
::error::PATCH /zones/z1/settings/security_header -> 403 9109: mock
```

So a clean dry run proves the token can read the zone. It does not prove it can write. The first real apply is the permission test. After it, the workflow's verify steps check the live headers and HSTS value.

## One token or two

The workflow was written for a separate secret, `CLOUDFLARE_ZONE_TOKEN`. The first version's header said it was "Kept separate from the Pages-only blog token so neither is broader than needed." The blog deploy in `blog.yml` uses `CLOUDFLARE_API_TOKEN`, scoped to Account > Cloudflare Pages > Edit.

The commit that followed records that the zone permissions were added to the existing `CLOUDFLARE_API_TOKEN` instead. The workflow now reads either one:

```yaml
CLOUDFLARE_ZONE_TOKEN: ${{ secrets.CLOUDFLARE_ZONE_TOKEN || secrets.CLOUDFLARE_API_TOKEN }}
```

That trade is worth knowing. With one token, the step that deploys the blog with Wrangler also holds Transform Rules and Zone Settings edit rights. Because the workflow still prefers `CLOUDFLARE_ZONE_TOKEN`, splitting them again takes no code change: create a zone-only token, save it as that secret, and remove the zone permissions from the Pages token.

## The steps, for the next token

1. Create a custom token with Zone > Zone > Read on the one zone.
2. Run the workflow by hand from the Actions tab (`workflow_dispatch`).
3. Read the `::error::` line. The path names the API, and the API names the permission group.
4. Add that one permission, and only on that zone.
5. Rerun until the apply and verify steps both pass.
6. Write the final list in the workflow header and the script's `Env:` comment.

The same method applies to the build and deploy side. [Hardening a static site](/hardening-a-static-site/) covers the GitHub token half of this: `contents: read` by default and write access only where a step needs it.
