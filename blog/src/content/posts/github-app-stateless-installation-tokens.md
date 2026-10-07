---
title: "GitHub App ghs_ tokens are now ~520 characters: what breaks"
description: "GitHub App installation tokens are now about 520 characters in the ghs_APPID_JWT format. Check length limits, regexes, and secret scanners before November 30."
date: 2026-10-07T10:07:24Z
tags: [github, github-actions, secrets, devsecops, security]
takeaways:
  - "Since October 2, 2026, newly minted GitHub App installation tokens default to the stateless ghs_APPID_JWT format, about 520 characters long instead of 40."
  - "The X-GitHub-Stateless-S2S-Token header that lets an app request the old token format will be deprecated on November 30, 2026."
  - "The default github-app-token rule in gitleaks v8.30.1 does not match a token in the new ghs_APPID_JWT shape, and no default gitleaks rule flagged it in testing."
  - "GitHub recommends the pattern ghs_[A-Za-z0-9\\.\\-_]{36,} to match both old and new installation tokens."
  - "Token permissions, repository scoping, the one-hour expiry, and the REST endpoint did not change; only the token string did."
---

GitHub [finished rolling out stateless GitHub App installation tokens on October 2, 2026](https://github.blog/changelog/2026-10-02-stateless-github-app-installation-tokens-rolled-out). New `ghs_` tokens, including the Actions `GITHUB_TOKEN`, are now about 520 characters long instead of 40. Check anything that stores, validates, forwards, or redacts these tokens before November 30, 2026, when the opt-out header stops working.

## What changed on October 2

From GitHub's [rollout notice](https://github.blog/changelog/2026-10-02-stateless-github-app-installation-tokens-rolled-out):

- "By default, all newly minted GitHub App installation tokens will be in the stateless `ghs_APPID_JWT` format."
- "Installation tokens still start with the `ghs_` prefix, but they're now about 520 characters long instead of 40."
- "Token permissions, repository scoping, the one-hour expiration, and the installation access token REST API endpoint are unchanged."
- "Tokens minted before the change continue to work until they expire."

The rollout started on April 27, 2026. The [April notice](https://github.blog/changelog/2026-04-24-notice-about-upcoming-new-format-for-github-app-installation-tokens/) says the first phase covered "GitHub Actions-issued `GITHUB_TOKEN` and the GitHub App installation tokens issued to all the other first-party featured integrations (e.g., Dependabot, Slack, and Teams)". All other installation tokens followed from mid-May. So the Actions `GITHUB_TOKEN` was among the first tokens to change. Your own GitHub Apps, bots, and internal tools that mint installation tokens are the ones to check now.

Scope, from the same notice: the change "applies to GitHub Enterprise Cloud and Data Residency environments. GitHub Enterprise Server isn't impacted by this change." It covers installation (server-to-server) tokens. The April notice said format changes for user-to-server tokens used in Copilot code review flows would be announced separately.

## The new token shape

The JWT (JSON Web Token) part is signed by GitHub. The April notice says it "is signed using a GitHub-internal issuer and cannot nor should not be validated by a client app", and that "client apps must not take a dependency on the contents of this JWT."

![The legacy ghs_ token is 36 characters after the prefix. The stateless token adds an app ID, an underscore, and a three-part JWT. A pattern test shows which regexes match each.](/diagrams/github-app-stateless-tokens-patterns.svg)

| Property | Legacy (stateful) | Stateless |
| --- | --- | --- |
| Prefix | `ghs_` | `ghs_` |
| Length | 40 | About 520, varies with contents |
| Body | 36 letters and digits | App ID, `_`, then a JWT |
| Dots | 0 | 2 |
| Lifetime | 1 hour | 1 hour |

GitHub's [header changelog](https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header) gives a quick test: "a stateless JWT-format token has two dots, while a stateful opaque token has no dots."

## What breaks with 520-character tokens

GitHub's [October 2 notice](https://github.blog/changelog/2026-10-02-stateless-github-app-installation-tokens-rolled-out) lists four places to look:

| Where | Failure mode |
| --- | --- |
| Validation code | Rejects tokens that are not exactly 40 characters or do not fit the old pattern |
| Database columns, secret stores, environment variables | Truncate or reject values over a fixed maximum length |
| Proxies, gateways, middleware | "truncate or reject long `Authorization` headers" |
| Logging and secret redaction | Rules "that only match the legacy token pattern" let the token through |

The first three show up as errors: failed requests or failed token writes. The fourth fails silently. The token works, and it also lands in logs in clear text.

## Secret scanners that miss the new format

Tested on October 7, 2026 with a synthetic token built in the documented `ghs_APPID_JWT` shape (a 7-digit app ID, an underscore, then a base64url header, payload, and signature) and a synthetic 40-character legacy token:

| Pattern | Legacy token | Stateless token |
| --- | --- | --- |
| `ghs_[A-Za-z0-9]{36}` | Full match | No match |
| gitleaks v8.30.1 default rule `github-app-token` | Full match | No match |
| TruffleHog v2 GitHub detector regex | Full match | Matches only up to the first dot |
| `ghs_[A-Za-z0-9\.\-_]{36,}` (GitHub's recommendation) | Full match | Full match |

Details:

- **gitleaks.** The [default config](https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml) defines `github-app-token` as `(?:ghu|ghs)_[0-9a-zA-Z]{36}`. The underscore after the app ID ends the match after a few digits, so the rule never reaches 36 characters. `gitleaks dir` with v8.30.1 (the latest tag on the Go module proxy when checked) reported `no leaks found` on the stateless token. Its generic `jwt` rule also missed it, because that rule starts with a word boundary and the JWT here follows an underscore.
- **TruffleHog.** The [v2 GitHub detector](https://github.com/trufflesecurity/trufflehog/blob/main/pkg/detectors/github/v2/github.go) uses `\b((?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{36,255})\b`. Run against the test token with an equivalent regex engine, it captured the prefix, app ID, and JWT header, and stopped at the first dot. A redaction step built on that span would leave the payload and signature in the log. TruffleHog itself was not run in this test.

GitHub's own recommendation, from the [header changelog](https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header): "Our recommended regex to match both new and current format tokens is `ghs_[A-Za-z0-9\.\-_]{36,}`."

Short-lived tokens limit the damage. A leaked installation token expires within the hour. That still leaves an hour, and the log line stays forever. If your CI already handles high-value credentials, as in the [@subql/common npm compromise](/subql-npm-trusted-publishing-compromise/), unredacted tokens in build logs widen what an attacker can collect.

## What to check before November 30, 2026

1. **Find hardcoded patterns and lengths.** Search your code, log pipeline configs, and scanner configs:

   ```bash
   grep -rnE 'ghs_\[|\{36\}|len\(.*token.*\) *[=!]= *40' \
     --include='*.go' --include='*.py' --include='*.js' --include='*.ts' \
     --include='*.rb' --include='*.java' --include='*.toml' --include='*.yaml' --include='*.yml' .
   ```

   Replace token validation with a prefix check, or with GitHub's recommended regex. Treat the token as an opaque string.

2. **Check column sizes.** On PostgreSQL or MySQL:

   ```sql
   SELECT table_name, column_name, character_maximum_length
   FROM information_schema.columns
   WHERE column_name LIKE '%token%'
     AND character_maximum_length < 520;
   ```

   The April notice asks for columns that "can fit at least a 520 character string". Leave headroom, since the length varies.

3. **Add a stateless rule to gitleaks.** This config keeps the defaults and adds a rule for the new shape. With v8.30.1 it flagged both test tokens:

   ```toml
   [extend]
   useDefault = true

   [[rules]]
   id = "github-app-token-stateless"
   description = "GitHub App installation token, stateless ghs_APPID_JWT format"
   regex = '''ghs_[A-Za-z0-9.\-_]{36,}'''
   keywords = ["ghs_"]
   ```

   Run it with `gitleaks dir . -c gitleaks.toml`. Apply the same regex to log redaction rules in your log shipper or SIEM (security information and event management) pipeline.

4. **Test your app with both formats.** The `X-GitHub-Stateless-S2S-Token` header on `POST /app/installations/{installation_id}/access_tokens` accepts `enabled` (stateless token) or `disabled` (classic token). The endpoint requires an app JWT, per the [REST API docs](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app):

   ```bash
   curl -sS -X POST \
     -H "Authorization: Bearer $APP_JWT" \
     -H "Accept: application/vnd.github+json" \
     -H "X-GitHub-Stateless-S2S-Token: enabled" \
     "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens" \
     | jq -r .token | awk -F. '{print NF-1}'
   ```

   `2` means a stateless token, `0` a classic one. The changelog notes that any value other than `enabled` or `disabled` "is silently ignored".

5. **Remove the header before November 30.** The October 2 notice says that after that date "GitHub will no longer respect the header, and all eligible apps will always receive stateless tokens." Any service still pinned to `disabled` gets the long format on that day whether it is ready or not.

6. **Check what sits in front of GitHub.** Egress proxies, API gateways, and service meshes that inspect or rewrite `Authorization` headers need to pass about 520 characters through intact.

## Related reading

For another case where CI credentials and GitHub workflow settings decided the outcome, see [how @subql/common 5.8.3 shipped through npm trusted publishing](/subql-npm-trusted-publishing-compromise/). For agent tooling that reads tokens and logs on developer machines, see the [Claude Code mods security guide](/claude-code-mods-security-guide/).
