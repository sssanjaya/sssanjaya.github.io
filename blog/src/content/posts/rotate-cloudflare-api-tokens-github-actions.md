---
title: "Rotating Cloudflare API tokens in GitHub Actions: a runbook"
description: "Rotate a Cloudflare API token used by GitHub Actions with no gap: create the new token, update the secret, verify with a manual run, then delete the old one."
date: 2026-10-05
tags: [cloudflare, github-actions, security, ci]
takeaways:
  - "Creating a new Cloudflare API token before deleting the old one avoids a gap, because Roll invalidates the previous token as soon as you confirm."
  - "This site's blog deploy reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, and its edge-headers job reads CLOUDFLARE_ZONE_TOKEN with CLOUDFLARE_API_TOKEN as the fallback."
  - "A workflow that only checks that a secret is non-empty will pass that check with a revoked token and fail later, at the first real API call."
  - "Verify a rotated token with a manual workflow_dispatch run of every workflow that reads it, not by waiting for the next scheduled run."
  - "An environment secret overrides a repository secret of the same name, but only for jobs that declare that environment."
---

To rotate the Cloudflare API tokens this site uses, create the replacement token first, paste it into the GitHub Actions secret, and run each workflow that reads the secret by hand. Delete the old token only after both runs pass. Cloudflare's Roll button is faster, but it invalidates the old value the moment you confirm, so the site has no working token until the secret is updated.

The steps below are specific to this repo's two Cloudflare workflows. The method carries over to any repo that keeps a Cloudflare token in Actions secrets.

## Which workflow reads which Cloudflare secret

Two workflows call Cloudflare. They read different secrets and need different permissions.

| Workflow | Secret it reads | What it does with it | Permissions the workflow header lists |
|---|---|---|---|
| `.github/workflows/blog.yml` | `CLOUDFLARE_API_TOKEN` | Runs Wrangler to deploy `blog/dist` to Cloudflare Pages | Account > Cloudflare Pages > Edit |
| `.github/workflows/blog.yml` | `CLOUDFLARE_ACCOUNT_ID` | Tells Wrangler which account the Pages project lives in | Not a credential |
| `.github/workflows/edge-headers.yml` | `CLOUDFLARE_ZONE_TOKEN`, else `CLOUDFLARE_API_TOKEN` | Applies the header Transform Rule and the zone's HSTS (HTTP Strict Transport Security) setting | Zone > Zone > Read, Zone > Transform Rules > Edit, Zone > Zone Settings > Edit |

The fallback in `edge-headers.yml` is one expression, repeated in each step that needs the token:

```yaml
CLOUDFLARE_ZONE_TOKEN: ${{ secrets.CLOUDFLARE_ZONE_TOKEN || secrets.CLOUDFLARE_API_TOKEN }}
```

A secret that is not set evaluates to an empty string, which is falsy, so the job uses `CLOUDFLARE_API_TOKEN` only when `CLOUDFLARE_ZONE_TOKEN` is missing. The commit that added this fallback records that the zone permissions went onto the existing `CLOUDFLARE_API_TOKEN` rather than a separate token. So before you rotate, check which secrets exist under Settings > Secrets and variables > Actions:

- Only `CLOUDFLARE_API_TOKEN`: one token serves both workflows. It needs the Pages permission and all three zone permissions.
- Both secrets: each workflow has its own token. Rotate them one at a time.

How those permissions were found, one failed call at a time, is in [least-privilege Cloudflare API tokens](/cloudflare-api-token-least-privilege/). This post assumes the list in each workflow header is current.

## Why a revoked token can go unnoticed

Both workflows check the secret before using it, but the check only tests that it is non-empty. In `blog.yml`:

```bash
if [ -n "$CF_TOKEN" ] && [ -n "$CF_ACCOUNT" ]; then
  echo "ready=true" >> "$GITHUB_OUTPUT"
else
  echo "::warning::CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set. Built the blog, skipped the deploy."
fi
```

A deleted or rolled token is still a non-empty string in the secret. It passes this check, and the job fails later, at the first Wrangler call.

The schedule makes that later failure easy to miss. The daily 11:00 UTC run deploys only when the post list in the fresh build differs from the live RSS feed. On a day with no newly due post, the run never reaches Wrangler, so it passes with a dead token. The first red run shows up on the day a post is due, and that post stays unpublished until the token is fixed. [Publishing on a schedule with no backend](/publishing-on-a-schedule-with-no-backend/) covers that gate in detail.

`edge-headers.yml` has no schedule at all. It runs on pushes that touch `infra/cloudflare/**` or the workflow file, and on `workflow_dispatch`. A bad token there stays silent until the next change to the header rule.

That is why the runbook ends with manual runs. Push and manual runs of `blog.yml` skip the due-post check and always deploy, and every manual run of `edge-headers.yml` reaches the API.

## Roll or create a new token

Cloudflare offers two ways to replace a token, described in [Roll tokens](https://developers.cloudflare.com/fundamentals/api/how-to/roll-token/):

| Option | Old value | New value | Permissions |
|---|---|---|---|
| Roll | Invalid as soon as you confirm | New secret on the same token | Same as before |
| Create a new token, then delete the old one | Valid until you delete it | New token | Whatever you select, so copy them from the workflow header |

Roll keeps the permissions for you, which removes one way to get it wrong. The cost is the window between confirming and saving the new secret in GitHub. Any run that calls Cloudflare in that window fails. For this site the window is short and only a deploy would notice, but creating a new token has no window at all, so the steps below use it.

## Rotation steps

1. Open [Settings > Secrets and variables > Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) in the repo. Note which of `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_TOKEN` exist. Check the `blog` environment too, under Settings > Environments.
2. In the Cloudflare dashboard, open My Profile > API Tokens and [create a custom token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/). Give it the permissions from the workflow header that reads this secret. Limit zone permissions to the one zone, `sanjayhona.com.np`. Copy the value; Cloudflare shows it once.
3. Optional: confirm the token is active before touching GitHub. For a token created under My Profile, Cloudflare's [verify endpoint](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/verify/) returns its status:

   ```bash
   curl -sS "https://api.cloudflare.com/client/v4/user/tokens/verify" \
     -H "Authorization: Bearer $NEW_TOKEN"
   ```

   This proves the token exists and is active. It does not prove it has the right permissions.
4. Replace the secret value in GitHub, at the same level it was before. With the [GitHub CLI](https://cli.github.com/manual/gh_secret_set), `gh secret set CLOUDFLARE_API_TOKEN` prompts for the value. Add `--env blog` only if the secret lived in the `blog` environment.
5. Run `Deploy blog` from the Actions tab with Run workflow ([manual runs](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow)). It builds `main` and deploys it again. Posts dated in the future stay hidden, because the build leaves them out.
6. If this token also serves the zone jobs, run `Edge headers` the same way. A repeat run is safe: `security-headers.mjs` writes the same rule back in place, matched by its `ref`, and `hsts.mjs` skips the `PATCH` when the live value already matches.
7. When both runs are green, delete the old token in the Cloudflare dashboard.
8. If you split tokens or changed a permission, update the comment at the top of the workflow that reads it, so the next rotation starts from the right list.

`CLOUDFLARE_ACCOUNT_ID` does not change when the token does. Leave it alone.

## Environment secrets and repository secrets

The deploy job in `blog.yml` declares an environment:

```yaml
environment:
  name: blog
  url: https://blog.sanjayhona.com.np
```

`edge-headers.yml` declares none. GitHub gives an environment secret precedence over a repository secret with the same name, and only jobs that name the environment can read it. Two things follow:

- If `CLOUDFLARE_API_TOKEN` exists both in the `blog` environment and at the repository level, the blog deploy uses the environment copy. Updating only the repository copy leaves the blog on the old token.
- A token stored only in the `blog` environment is invisible to `edge-headers.yml`. That job would fall through to an empty value and skip with its `::warning::`.

The repo README describes the two blog secrets as repository secrets. Step 1 is there to confirm that before you change anything.

## Reading a failed verification run

A red run after rotation almost always means a missing permission or a value pasted into the wrong place. Where it fails tells you which.

In `blog.yml`, the deploy step first lists Pages projects and greps for the project name:

```bash
if npx --yes "$WRANGLER" pages project list | grep -qw "$PROJECT"; then
  echo "Pages project $PROJECT exists."
else
  npx --yes "$WRANGLER" pages project create "$PROJECT" --production-branch=main
fi
```

Without `shell: bash`, a GitHub Actions `run:` step uses `bash -e` with no `pipefail`, so the `if` sees only the exit code of `grep`. If the token is rejected, `pages project list` prints Cloudflare's error and exits 1, `grep` finds nothing, and the script falls into the `else` branch. The step then fails on `pages project create`. The last command in the log is the create, but the cause is the authentication error printed by the list call above it. Read up from the bottom.

In `edge-headers.yml`, both scripts print the failing call as an `::error::` annotation with the HTTP method, the API path, the status, and Cloudflare's error code. The path names the permission group that is missing:

| Path in the error | Permission to add |
|---|---|
| `/zones?name=...` returns nothing (`zone sanjayhona.com.np not visible to this token`) | Zone > Zone > Read on this zone |
| `.../rulesets/phases/http_response_headers_transform/entrypoint` | Zone > Transform Rules > Edit |
| `.../settings/security_header` | Zone > Zone Settings > Edit |

The last step of `edge-headers.yml` checks the hstspreload.org API. That step fails when hstspreload.org reports any error for the domain, which says nothing about the token. If every step before it passed, the token works.

For the rest of what `edge-headers.yml` sets and why, see [security headers and HSTS preload as code](/security-headers-and-hsts-preload-as-code/).
