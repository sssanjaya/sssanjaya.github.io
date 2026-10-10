---
title: "Claude Code plugin SHA pin bypass: CVE-2026-86063"
description: "A branch named after a pinned commit SHA let Claude Code before 2.1.179 install attacker plugin code. Check your version floor and scan pinned plugin repos."
date: 2026-10-10T10:10:31Z
tags: [claude, claude-code, ai-security, supply-chain, devsecops]
takeaways:
  - "Claude Code before 2.1.179 could install attacker code for a plugin pinned to a commit SHA, because it ran git checkout on the SHA without checking where HEAD landed."
  - "The trick is a branch named after the 40-character pinned SHA: git resolves the name as a ref first and only prints a refname is ambiguous warning."
  - "Anthropic published the advisory GHSA-pq7j-f95f-qfcv for CVE-2026-86063 on October 9, 2026, rated High with a CVSS v4 score of 7.7."
  - "Claude Code 2.1.296 refuses such an install with the error SHA pin verification failed, which a sandbox test confirmed on October 10, 2026."
  - "Any machine or container image that runs Claude Code below 2.1.179 needs an update, and pinned plugin repositories on hosts other than GitHub need a scan for SHA-named refs."
---

Anthropic published [GHSA-pq7j-f95f-qfcv](https://github.com/anthropics/claude-code/security/advisories/GHSA-pq7j-f95f-qfcv) on October 9, 2026. It says Claude Code and Claude Desktop could install attacker-controlled plugin code even when a marketplace pinned the plugin to a reviewed commit SHA. The fix is in Claude Code 2.1.179, so set that as the floor on every laptop, CI runner, and container image, then scan the repositories your pinned plugins come from.

## What the advisory says

| Field | Value |
|---|---|
| CVE | CVE-2026-86063 |
| Package | npm `@anthropic-ai/claude-code` |
| Affected | `< 2.1.179` |
| Patched | `2.1.179` |
| Severity | High, CVSS v4 7.7, scored by Anthropic in the advisory |
| Weaknesses | CWE-494, CWE-829 |

The advisory states the root cause directly: the install flow "checked out a marketplace's pinned commit SHA using `git checkout` without verifying that the resulting HEAD matched the pinned SHA." An attacker who controls the plugin's upstream repository "could create a branch named identically to the pinned 40-character SHA."

Exploitation needs three things, per the advisory: a user installs the malicious plugin, the plugin is pinned to a safe hash, and the source lives on "a git host that permitted SHA-shaped branch names."

The CVE record for CVE-2026-86063 was not yet published on CVE.org when checked on October 10, 2026. The GitHub advisory is the primary source for now.

The fix is not new. The [npm registry](https://registry.npmjs.org/@anthropic-ai/claude-code) shows 2.1.179 was published on June 16, 2026. Users on auto-update already have it. The risk sits with pinned installs: golden images, devcontainers, and CI jobs that install a fixed version.

## How a branch name beats a commit pin

Air Security, who reported the bug, published the details as [Plugin4Shell on September 17, 2026](https://www.air.security/blog-posts/plugin4shell). Their write-up says the agents ran `git clone <plugin repo> ./` and then `git checkout <40-hex SHA>`. If the attacker makes the SHA-named branch the default branch, the clone creates it as a local branch. Then, in Air's words, "git prefers the ref and only prints a `refname is ambiguous` warning."

The branch must be the default. Air notes that a non-default branch arrives only as a remote-tracking ref, and checkout then falls back to the commit.

![Four steps from a marketplace SHA pin to attacker code: the pin, a default branch named after the SHA, git clone creating a local branch, and git checkout choosing the branch. Before 2.1.179 the code installs; from 2.1.179 the install is refused](/diagrams/claude-code-plugin-sha-pin-flow.svg)

A local reproduction with git 2.43.0 matched this. With the upstream default branch named after the safe commit, `git clone` followed by `git checkout <sha>` printed:

```text
warning: refname 'c1c69a4886e017fa580104943a64a2e26c08c778' is ambiguous.
Already on 'c1c69a4886e017fa580104943a64a2e26c08c778'
```

`git rev-parse HEAD` then returned the attacker commit, not the pinned one. The same test with the evil branch left as a non-default branch checked out the correct commit.

## Which git hosts and agents are exposed

Air says GitHub rejects 40-hex branch names, and names Bitbucket and self-hosted git servers as hosts that accept them. Their post does not cover GitLab. So the branch trick needs a plugin hosted off GitHub, which the [`url` and `git-subdir` plugin sources](https://code.claude.com/docs/en/plugins/marketplace-reference) allow.

The same flaw hit other coding agents. Status as Air reported it on September 17, 2026:

| Agent | Status per Air Security |
|---|---|
| Claude Code | Fixed in 2.1.179 |
| OpenAI Codex | Fixed in 0.146.0 |
| GitHub Copilot | No fix shipped at disclosure |
| Gemini CLI | Deprecated, will not be patched |

Air also describes a zero-click path. Background plugin auto-update re-runs the same checkout, so when a marketplace bumps the pinned SHA, an installed plugin can be swapped with no prompt. "The attacker does not need to persuade anyone to install anything new." Note that the Claude Code [plugin loading reference](https://code.claude.com/docs/en/plugins/loading) lists auto-update as off by default for marketplaces other than Anthropic's official ones, so exposure depends on how each marketplace is configured.

## What the fix looks like in 2.1.296

The marketplace reference says `sha` takes "a full 40-character lowercase commit SHA" and that when both `ref` and `sha` are set, "Claude Code checks out `sha`." The fix adds a check after that checkout.

A test on October 10, 2026 used Claude Code 2.1.296 and a local marketplace with a `url` source pinned by `sha`, pointing at a repository whose default branch carried the pinned SHA as its name. `claude plugin install` failed with:

```text
SHA pin verification failed: expected HEAD to be c5f6e6c155fcdb00309865b3a4a1daace5066ce1, got 5fceafabe5374aada93519aaec87c8bfcd645f8c. The pinned commit may have been removed upstream, or a ref with the same name exists. Refusing to install.
```

After deleting the SHA-named branch, the same install succeeded and `~/.claude/plugins/installed_plugins.json` recorded `"gitCommitSha": "c5f6e6c155fcdb00309865b3a4a1daace5066ce1"`.

## What to do

1. **Set a version floor.** Run `claude --version` on every host and image. Anything below 2.1.179 needs an update. Grep Dockerfiles and CI config for pinned `@anthropic-ai/claude-code@2.1.` versions below that.
2. **Reinstall pinned git plugins on a patched version.** A plugin installed by an affected version may already hold attacker code. A fresh `claude plugin install` on a patched version runs the HEAD check, as the 2.1.296 test above shows.
3. **Scan pinned plugin repositories for SHA-named refs.** Run this from a marketplace root. It reads every `github`, `url`, and `git-subdir` source with a `sha` and checks the upstream for a branch or tag with that exact name:

```bash
jq -r '.plugins[] | .source | objects | select(.sha)
  | (.repo // .url) as $u
  | (if ($u | test("^(https?|file)://|^git@")) then $u
     else "https://github.com/" + $u + ".git" end) as $url
  | [$url, .sha] | @tsv' .claude-plugin/marketplace.json |
while IFS=$'\t' read -r url sha; do
  if git ls-remote --heads --tags "$url" | grep -qE "refs/(heads|tags)/$sha$"; then
    echo "BAD  $url has a ref named $sha"
  else
    echo "ok   $url"
  fi
done
```

A `BAD` line means someone created a ref whose name is your pinned commit. Treat that repository as hostile.

4. **Watch for the git warning.** `refname '...' is ambiguous` in any build or install log, next to a 40-hex name, is the signature of this trick.
5. **Prefer plugin sources on GitHub.** Air's post says GitHub rejects SHA-shaped branch names. `strictKnownMarketplaces` limits which marketplaces users can add, not where each plugin in them is hosted, so review the plugin sources inside each allowed `marketplace.json` as well.

## The other Claude Code advisory this week

Anthropic also published [GHSA-5j29-h97v-84ch](https://github.com/anthropics/claude-code/security/advisories/GHSA-5j29-h97v-84ch) on October 5, 2026. The [CVE-2026-103435 record](https://cveawg.mitre.org/api/cve/CVE-2026-103435) describes a time-of-check to time-of-use (TOCTOU) race: Claude Code checked that a write target was inside the project, then re-resolved the path at write time. A user who can write to a shared workspace could swap a file for a symlink and redirect edits "to sensitive files (e.g., shell configuration) in a higher-privileged session." It affects versions below 2.1.129, so a 2.1.179 floor covers both.

For more on locking down what Claude Code loads, see the [Claude Code mods security guide](/claude-code-mods-security-guide/) and why [Claude Code hooks fail open without onFailure block](/claude-code-hooks-onfailure-block/). For a recent supply chain case outside AI tooling, see the [@subql/common npm trusted publishing compromise](/subql-npm-trusted-publishing-compromise/).
