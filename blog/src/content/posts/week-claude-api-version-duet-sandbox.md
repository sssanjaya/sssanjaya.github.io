---
title: "Claude API 2026-10-21 Rejects temperature, and 4 More"
description: "API version 2026-10-21 turns temperature into a 400, Claude Code 2.1.309 closes sandbox gaps, plus Duet, Claude Security, and Claude on Google Cloud."
date: 2026-10-26T10:09:52Z
tags: [claude-api, claude-code, security, ai-agents, productivity]
takeaways:
  - "Claude API version 2026-10-21 returns a 400 error for any request that sends temperature, top_p, or top_k, even at the default value."
  - "The new SDK majors (Python 2.0.0, TypeScript 1.0.0, Go 2.0.0, Java 3.0.0, C# 13.0.0) send 2026-10-21 by default and move from the MIT License to Apache 2.0."
  - "Claude Code 2.1.309 stopped sandboxed Bash commands from running the shell's startup files outside the sandbox before each command."
  - "Claude Security now runs a baseline scan, scans changes by risk, marks findings fixed when the fix lands, and reopens them if the issue returns."
  - "Claude Models on Google Cloud (Anthropic managed) is generally available, with Google Cloud IAM and billing and Anthropic as the data processor."
---

A request that sends `"temperature": 0.2` to the Claude API now gets a 400 error, as long as it carries the header `anthropic-version: 2026-10-21`. That version shipped on October 21 with new major versions of every official SDK, and the SDKs send it by default. The same week brought a Claude Code release that closes several sandbox gaps, continuous scanning in Claude Security, a research preview of a proactive agent app called Claude Duet, and an Anthropic-run Claude API inside Google Cloud. Below are the five items, each with what to check.

## Claude API 2026-10-21 removes sampling parameters

<figure>
  <img src="/diagrams/week-claude-api-version-duet-sandbox-api.svg" alt="The same Messages request with temperature 0.2 to claude-sonnet-4-6 returns 200 under anthropic-version 2023-06-01 and a 400 error under 2026-10-21. New SDK majors that send 2026-10-21 by default: Python 2.0.0, TypeScript 1.0.0, Go 2.0.0, Java 3.0.0, C# 13.0.0, ant CLI 2.0.0, PHP 1.0.0, Ruby 2.0.0." width="900" height="470" loading="lazy" />
  <figcaption>The request body is the same; only the version header changes the answer. Upgrading the SDK changes the header for you.</figcaption>
</figure>

The [October 21 platform release notes](https://platform.claude.com/docs/en/release-notes/overview) announce API version `2026-10-21` and SDKs that "send API version `2026-10-21` by default." The [migration guide](https://platform.claude.com/docs/en/api/migration-2026-10-21) lists the breaks. The one most likely to page someone: "a request that sends `temperature`, `top_p`, or `top_k` returns a 400 error, even at the parameter's default value." Two more Messages API changes return 400: `document` blocks placed directly in `assistant` messages, and non-empty `citations` on `text` blocks in `user` messages. Admin API fields are renamed too, for example `workspace_id` on API keys becomes `scope`.

Models that already accept only default sampling, "such as Claude 4.7 and later models, sample as before." On models that accept other values, such as Claude Sonnet 4.6, a lowered temperature "loses that effect. No other setting replaces it." The guide's way out is to keep that request on `2023-06-01`.

Running the same script against Python SDK 1.17.0 and 2.0.0 from PyPI, with a mock HTTP transport that records the outgoing header, shows what an upgrade changes on the wire:

```console
$ pip install anthropic==1.17.0 && python check.py
anthropic 1.17.0
TypeError: Messages.create() got an unexpected keyword argument 'temperature'
anthropic-version: 2023-06-01

$ pip install anthropic==2.0.0 && python check.py
anthropic 2.0.0
TypeError: Messages.create() got an unexpected keyword argument 'temperature'
anthropic-version: 2026-10-21
```

The Python SDK already rejected `temperature` in 1.17.0, so Python callers mostly feel the header switch. `pip show` reports `License: MIT` for 1.17.0 and `License: Apache-2.0` for 2.0.0, matching the release note that the new versions "are licensed under Apache 2.0 instead of the MIT License." Two traps from the guide: Go needs the new module path `github.com/anthropics/anthropic-sdk-go/v2`, and the old `ant` CLI install path "keeps installing the latest v1 release, with no error or warning." On Bedrock, `2026-10-21` "is available only for Claude 4.7 and later models."

**So what:** grep for `temperature`, `top_p`, and `top_k` in every service that calls Claude, including raw HTTP clients and gateways that set the header themselves, before a dependency bot merges the SDK major.

## Claude Code 2.1.309 closes sandbox gaps

<figure>
  <img src="/diagrams/week-claude-api-version-duet-sandbox-sandbox.svg" alt="Before 2.1.309, a sandboxed Bash command first ran the shell's startup files outside the sandbox, and the command inside could edit the file passed with --mcp-config. From 2.1.309 the startup files no longer run outside first and the command can no longer edit that file." width="900" height="430" loading="lazy" />
  <figcaption>The sandbox boundary started after code that ran on every command. 2.1.309 moves nothing outside it.</figcaption>
</figure>

Claude Code 2.1.309, published to [npm](https://www.npmjs.com/package/@anthropic-ai/claude-code) on October 22, lists 62 bug fixes in the [changelog](https://code.claude.com/docs/en/changelog). Several are sandbox and permission boundaries. The first one in the list: "Fixed sandboxed Bash commands on macOS and Linux running the shell's startup files outside the sandbox before each command." Whatever those startup files ran, it ran unconfined, once per sandboxed call.

The same release fixed "sandboxed commands and auto-accepted edits being able to modify the MCP config file passed with `--mcp-config`," macOS `denyWrite` globs not applying through symlinked folders, an `Edit(path)` deny rule missing some Bash redirects that also held a subshell, and on Linux "sandbox write denies lifting when a background command outlived the session." It also changed `claude ultrareview` to require workspace trust; scripts now pass `--trust-workspace`.

One setting from 2.1.305 (October 20) cuts the other way. `sandbox.allowNestedUserNamespaces` lets sandboxed commands on Linux create user namespaces for Chromium or rootless podman, and the changelog warns "this lets them get around the sandbox's file protections."

**So what:** upgrade to 2.1.309 or later (`claude --version`), and treat `allowNestedUserNamespaces` as a decision to weaken the sandbox, not a compatibility toggle.

## Claude Security scans continuously and tracks fixes

<figure>
  <img src="/diagrams/week-claude-api-version-duet-sandbox-security.svg" alt="Claude Security flow: a project with repositories and a knowledge base, a deep baseline scan with an editable threat model, change scans by risk and complexity, an open finding with severity and attack path, then marked fixed automatically when a fix lands anywhere, and reopened if found again. Findings go out through an API, webhooks, and an MCP connector." width="900" height="440" loading="lazy" />
  <figcaption>The new part is the loop on the right: findings close and reopen from code changes, not from someone clicking resolve.</figcaption>
</figure>

On October 21 Anthropic said [Claude Security now scans continuously and tracks fixes](https://claude.com/resources/articles/claude-security-now-scans-continuously-and-tracks-fixes). After a deep baseline scan, Claude "scans changes regularly based upon their risk and complexity." It "checks open findings against the code that changed and marks them fixed when the fix lands," and "If Claude Security finds the issue again later, the finding reopens automatically." The post gives no fixed scan schedule.

Each project gets a knowledge base and a generated threat model that later scans use "to decide what's worth flagging." A new API lists, resolves, and reopens findings, webhooks fire on new findings, and an MCP connector brings findings into Claude Code. It is a public beta for Claude Enterprise, with "$25,000 in free usage credits each month, for two months" for usage through December 31, 2026.

**So what:** wire the new-finding webhook into the same queue as your other scanners, and write your real network boundaries into the knowledge base so severity reflects reachability.

## Claude Duet: a proactive agent with an approval line

<figure>
  <img src="/diagrams/week-claude-api-version-duet-sandbox-duet.svg" alt="Claude Duet checks connected apps every few hours on its own VM and browser. It reads, drafts, and prepares work on its own; it shows you and waits before sending a message, making a payment, signing a document, or deleting anything; trading securities and moving money between accounts are off-limits even with approval." width="900" height="450" loading="lazy" />
  <figcaption>The interesting design choice is the third lane: some actions stay blocked even when the user approves them.</figcaption>
</figure>

[Claude Duet](https://claude.com/resources/articles/claude-duet) opened as a research preview for Pro and Max plans on October 21, per the [Claude apps release notes](https://support.claude.com/en/articles/12138966-release-notes). Access is by waitlist, starting with US users, on iOS, Android, and claude.ai. It runs on "a virtual machine with its own browser" and "checks your connected accounts every few hours, because checking nonstop would use up your plan's limits much faster."

The approval model is the part worth studying: "before it sends a message, makes a payment, signs a document, or deletes anything, it shows you exactly what it's about to do and waits for your approval. A few things are off-limits even with your approval, like trading securities or moving money between accounts." A dedicated classifier is "designed to reject requests to share the strictest tier of information, including credit card numbers and government identification." Background checks count toward the same plan usage limits as the rest of Claude.

**So what:** if your team builds agents, the three-lane split (autonomous, approve-first, never) is a clear pattern to copy, and the same split runs through Claude Code's [auto mode classifier](/claude-code-auto-mode-classifier/).

## Claude API inside Google Cloud, run by Anthropic

<figure>
  <img src="/diagrams/week-claude-api-version-duet-sandbox-gcloud.svg" alt="Two offerings under one Google Cloud project with IAM and Google Cloud billing. Anthropic managed, newly GA: Anthropic is the data processor, full Claude Platform with betas on day one, Claude Console, US and Global endpoints, fast mode on Opus 5.5 at 8 and 40 dollars per million input and output tokens, service claude.googleapis.com, roles claude.user and claude.admin. Google managed: Google is the data processor, for strict regional data residency and native integrations such as Model Armor and Agent Engine." width="900" height="430" loading="lazy" />
  <figcaption>Same billing and IAM path, different operator and data processor. Pick on residency and feature lag, not on price.</figcaption>
</figure>

On October 22 Anthropic made [Claude Models on Google Cloud (Anthropic managed)](https://claude.com/resources/articles/claude-models-on-google-cloud-anthropic-managed) generally available: "the full set of Claude API features, with new features and betas shipping the same day," Google Cloud IAM credentials, and usage that "draws down your existing Google Cloud commitment." Anthropic "acts as the data processor." The Google managed offering "remains the best choice" for Google as processor, strict regional residency, or Model Armor and Agent Engine.

The [setup docs](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed) show the operational details: enable `claude.googleapis.com` and `anthropic-managed-claude.cloudpartnerservices.goog` on each calling project, grant `roles/claude.user` or `roles/claude.admin`, and expect a new Anthropic organization that is "separate from any Anthropic organization your company already has."

```bash
gcloud services enable claude.googleapis.com \
  anthropic-managed-claude.cloudpartnerservices.goog \
  --project=my-project-id
```

**So what:** the new organization means separate API keys, workspaces, and usage dashboards, so plan the cutover like a new account, not a region switch.

## What to do

1. Search code and gateway configs for `temperature`, `top_p`, `top_k`, assistant-side `document` blocks, and user-side `citations` before taking any SDK major from October 21.
2. Pin SDK majors in dependency bots until those searches come back clean, and update Go imports to `anthropic-sdk-go/v2`.
3. Upgrade Claude Code to 2.1.309 or later on every machine that relies on the sandbox, and review any `allowNestedUserNamespaces` setting.
4. If you run Claude Security on Enterprise, connect the webhook and fill in the project knowledge base.
5. Before moving Google Cloud traffic to the Anthropic managed offering, decide who the data processor must be and plan for a separate Anthropic organization.
