---
title: "Opus 4.8 Fast Mode Ends Nov 30, and 4 More Claude Changes"
description: "Fast mode on Opus 4.8 errors from Nov 30, Messages requests grow to 128 MB, a slower usage API, layered gateway policies, and subagent effort control."
date: 2026-11-02T11:09:12Z
tags: [claude-api, claude-code, productivity, ai-agents]
takeaways:
  - "After November 30, 2026, a request to claude-opus-4-8 with speed set to fast returns an error and does not fall back to standard speed."
  - "Fast mode on Claude Opus 5.5 costs $8 input and $40 output per million tokens, against $10 and $50 on Opus 4.8."
  - "The first-party Messages API now accepts 128 MB requests, but Amazon Bedrock still caps requests at 20 MB and the other partner platforms at 30 to 32 MB."
  - "The new Usage and Cost Analytics API typically refreshes within 4 hours and can take up to 24, where the legacy API typically shows data within 5 minutes."
  - "Claude Code 2.1.316 adds CLAUDE_CODE_SUBAGENT_EFFORT, so subagents with no effort set stop inheriting the session's effort level."
---

From November 30, a request to `claude-opus-4-8` with `speed: "fast"` stops working, and Claude Code says it will "not fall back to standard Opus 4.8." That deprecation landed on October 30, in a week that also quadrupled the Messages API request limit, shipped a usage API that trades minutes of freshness for hours, and gave Claude apps gateway admins and Claude Code users finer control over policy and subagent effort. Here are the five changes from October 26 to November 2, each with what to check.

## Fast mode on Opus 4.8 is deprecated, removal on November 30

<figure>
  <img src="/diagrams/week-opus-fast-mode-128mb-gateway-fastmode.svg" alt="Bar chart of fast mode prices per million tokens: Opus 4.8 fast input 10 dollars, Opus 5.5 fast input 8 dollars, Opus 4.8 fast output 50 dollars, Opus 5.5 fast output 40 dollars. Opus 4.8 fast mode is removed on November 30, 2026." width="900" height="428" loading="lazy" />
  <figcaption>The migration target is also the cheaper fast mode. Source: <a href="https://platform.claude.com/docs/en/build-with-claude/fast-mode">Claude Platform fast mode docs</a>.</figcaption>
</figure>

The [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview) for October 30 say: "After removal, requests to `claude-opus-4-8` with `speed: "fast"` will return an error. To continue using fast mode, migrate to Claude Opus 5.5." The [Claude Code 2.1.316 changelog](https://code.claude.com/docs/en/changelog) states the same for the CLI and adds that those requests "do not fall back to standard Opus 4.8." Fast mode on Opus 4.8 was a research preview behind the `fast-mode-2026-02-01` beta header. The [fast mode docs](https://platform.claude.com/docs/en/build-with-claude/fast-mode) list that header requirement only for Opus 5 and Opus 4.8.

Opus 4.7 went the same way: the [Claude Code fast mode page](https://code.claude.com/docs/en/fast-mode) records that its fast mode "was deprecated on June 25, 2026, and removed on July 24, 2026."

**So what:** an error with no fallback means a latency-tuned path fails outright instead of slowing down. List files that name the model and also set fast speed, then confirm with `usage.speed` in responses, which reads `"fast"` or `"standard"`.

```bash
grep -rlE 'claude-opus-4-8' . \
  | xargs -r grep -lE 'speed"?[[:space:]]*[:=][[:space:]]*"fast"'
```

## Messages API requests can now be 128 MB, on one platform

<figure>
  <img src="/diagrams/week-opus-fast-mode-128mb-gateway-size.svg" alt="Bar chart of maximum Messages request size: Claude API 128 MB from October 28 (32 MB before), Claude Platform on AWS 32 MB, Google Cloud Anthropic managed 32 MB, Microsoft Foundry 32 MB, Google Cloud Google managed 30 MB, Amazon Bedrock 20 MB." width="900" height="512" loading="lazy" />
  <figcaption>Only the first-party API moved. Code that fails over to Bedrock still has to fit in 20 MB. Source: <a href="https://platform.claude.com/docs/en/api/overview#request-size-limits">Claude API overview, request size limits</a>.</figcaption>
</figure>

On October 28 Anthropic "raised the maximum request size for the Messages API and the Token Counting API from 32 MB to 128 MB on the first-party Claude API," per the [release notes](https://platform.claude.com/docs/en/release-notes/overview). The [API overview](https://platform.claude.com/docs/en/api/overview#request-size-limits) lists the partner limits that did not change: "Bedrock limits requests to 20 MB, and Claude Models on Google Cloud (Google managed) limits requests to 30 MB," while Claude Platform on AWS, Google Cloud (Anthropic managed), and Microsoft Foundry stay at 32 MB. Sessions, Agents, and Environments endpoints also stay at 32 MB.

Over the limit, the [errors page](https://platform.claude.com/docs/en/api/errors#request-size-limits) says you get a `413 request_too_large`, and "On the first-party Claude API, Cloudflare returns this error before the request reaches the API servers."

**So what:** a large base64 PDF or image batch that now passes on the Claude API can fail the moment traffic fails over to another platform. Size-check against the smallest limit in your failover chain, and check the body limit of any proxy in front of the API.

## Usage and Cost Analytics API: richer rows, slower data

<figure>
  <img src="/diagrams/week-opus-fast-mode-128mb-gateway-analytics.svg" alt="Comparison of the legacy Usage and Cost API and the new Usage and Cost Analytics API. Freshness: 5 minutes typical versus 4 hours typical and up to 24 hours. Shape: time buckets with empty ones versus ranked rows with no empty rows. Range: any range versus 31 days per request and 24 hours with 1-minute buckets. Unknown ID: error versus matching nothing." width="900" height="470" loading="lazy" />
  <figcaption>Every amber or red cell is a way a migrated dashboard can show wrong numbers without throwing an error.</figcaption>
</figure>

The [Usage and Cost Analytics API](https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api) entered beta on October 29 behind `anthropic-beta: analytics-usage-cost-2026-08-24`, with `/v1/organizations/analytics/usage` and `/v1/organizations/analytics/cost`. It groups by model, workspace, API key, `speed`, and the user or service account behind each request, and the same endpoints serve Console and Enterprise organizations. The old Usage and Cost API is now legacy, and the release notes say all of the legacy endpoints "remain supported."

The trade-off sits in the docs' migration table. The legacy API: "Data typically appears within 5 minutes." The new one: "Data typically refreshes within 4 hours and can take up to 24 hours." Values "can be revised as late events arrive and reconciliation runs, until about 7 days after the end of the calendar month." And an unknown key or workspace ID "matches nothing, including a misspelled `models[]` name," where the legacy API returned an error.

```bash
curl --globoff "https://api.anthropic.com/v1/organizations/analytics/cost?\
starting_at=2026-10-01T00:00:00Z&ending_at=2026-11-01T00:00:00Z&\
time_bucket_width=1d&group_by[]=model&order_by=time&order=asc&limit=1000" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: analytics-usage-cost-2026-08-24" \
  -H "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

**So what:** keep spend alerts on the legacy API or your own gateway metrics, and use the new API for attribution and finance reports. Store `data_refreshed_at` next to every figure you chart.

## Claude apps gateway: layered policies and pooled budgets

<figure>
  <img src="/diagrams/week-opus-fast-mode-128mb-gateway-policy.svg" alt="A developer in groups eng and contractors. Default first-match evaluation applies only the contractors policy over the match-all base and skips the eng policy. With policy_mode layered, both apply: contractors over eng over the base. Below, pooled_budget adds one monthly budget shared by a group on top of each member's own limit." width="900" height="500" loading="lazy" />
  <figcaption>With first match, a developer in two groups silently loses the second group's policy. Layered mode stacks them.</figcaption>
</figure>

The [gateway configuration reference](https://code.claude.com/docs/en/claude-apps-gateway-config) describes the default: "Policies are evaluated in order; the first match is selected, then merged onto the `match: {}` catch-all base." Claude Code 2.1.316, released October 31 per the [changelog](https://code.claude.com/docs/en/changelog), adds `managed.policy_mode: layered`: "every policy that matches a developer applies, each merged over the ones listed below it, not only the first." As of November 2 the configuration reference still documents only first-match evaluation.

The same release adds "one monthly budget that a group's members share, on top of each member's own limit, set with `pooled_budget` on the spend limits admin API." It also fixes the gateway "not checking every model a request names against `availableModels`, `deniedModels` and `models`; a request that names a blocked model now gets a 400 naming the field."

**So what:** before switching to layered mode, list developers who sit in more than one policy group. The documented merge rules make allow-lists replace and deny-lists and hook arrays take the union. If layers merge the same way, a multi-group user gains every matching group's denies.

## Claude Code 2.1.316 lets subagents run at their own effort

<figure>
  <img src="/diagrams/week-opus-fast-mode-128mb-gateway-effort.svg" alt="Subagent effort precedence: CLAUDE_CODE_EFFORT_LEVEL first, then the effort parameter on the invocation, then the effort field in the subagent's frontmatter, then CLAUDE_CODE_SUBAGENT_EFFORT (new in 2.1.316), and finally the session effort level, which subagents inherited before." width="900" height="440" loading="lazy" />
  <figcaption>The new variable sits just above the session level, so it changes only subagents that nothing else configures.</figcaption>
</figure>

The [2.1.316 changelog](https://code.claude.com/docs/en/changelog) adds `CLAUDE_CODE_SUBAGENT_EFFORT` "to set the effort level subagents run at when nothing else names one, instead of inheriting the session's." The [subagents docs](https://code.claude.com/docs/en/sub-agents) give the order above it: the `effort` frontmatter field, then a per-invocation `effort` parameter that overrides it, and `CLAUDE_CODE_EFFORT_LEVEL`, which "takes precedence over both."

That matters since 2.1.311 made `ultrathink` run a turn at xhigh effort, covered in [how ultrathink sets xhigh effort](/claude-code-ultrathink-xhigh-effort/). The same release adds `CLAUDE_CODE_DISABLE_ULTRATHINK` to turn the keyword off.

```bash
export CLAUDE_CODE_SUBAGENT_EFFORT=medium
claude --version   # needs 2.1.316 or later
```

**So what:** set a lower default for helper subagents in shared environments, then raise effort per agent in frontmatter where a reviewer or planner needs it.

## What to do

1. Find every caller that sends `speed: "fast"` with `claude-opus-4-8` and move it to `claude-opus-5-5` before November 30, 2026.
2. Check request sizes against the smallest limit on your failover path (20 MB on Bedrock), not the new 128 MB.
3. Keep near-real-time spend alerts off the new analytics API, and record `data_refreshed_at` with any report built on it.
4. On the Claude apps gateway, list multi-group users and review their merged policy before setting `policy_mode: layered`.
5. Upgrade Claude Code to 2.1.316 or later and set `CLAUDE_CODE_SUBAGENT_EFFORT` where xhigh sessions spawn many subagents.

For last week's API version change and its 400 errors, see [the Claude API 2026-10-21 roundup](/week-claude-api-version-duet-sandbox/).
