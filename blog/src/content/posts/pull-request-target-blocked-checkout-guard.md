---
title: "pull_request_target Blocked Dec 2: The Gap Checkout Leaves"
description: "GitHub blocks pull_request_target in public repos on Dec 2, and actions/checkout now refuses fork code. A run: step still gets around it. Audit workflows now."
date: 2026-11-16T11:09:04Z
tags: [github-actions, ci-cd, supply-chain, security]
takeaways:
  - "From December 2, 2026, GitHub Actions blocks pull_request_target in public repositories that have no Actions event policy explicitly allowing it; private and internal repositories are not affected."
  - "actions/checkout v7, and the v2 to v6 major tags since July 16, 2026, fail with 'Refusing to check out fork pull request code' when a pull_request_target or workflow_run job asks for a fork's ref, repository, or PR SHA."
  - "The checkout guard only covers actions/checkout: a run step that uses gh pr checkout, git fetch, or a fork's artifact still runs fork code with the base repository's secrets."
  - "Workflows pinned to an actions/checkout commit SHA from before the guard releases keep the old behavior until the pin is bumped."
  - "Most pull_request_target workflows that test fork code can move to pull_request, or to a pull_request plus workflow_run split that treats artifacts as data."
---

Today, November 16, from 16:00 to 18:00 UTC, every `pull_request_target` run in a public GitHub repository without an Actions event policy fails before a single step runs. It is the second of two brownouts before [GitHub blocks the event by default on December 2, 2026](https://github.blog/changelog/2026-11-02-pull_request_target-blocked-by-default-december-2). If your public repos label, triage, or test fork pull requests with this trigger, you have 16 days to move them or allow them on purpose.

<figure>
  <img src="/diagrams/pull-request-target-blocked-checkout-guard-gates.svg" alt="Flow diagram. A pull request from a fork reaches Gate 1, the Actions default event policy, which fails the run in public repos with no policy. If allowed, the workflow runs from the default branch with secrets and a write GITHUB_TOKEN. A checkout of ref head.sha hits Gate 2, actions/checkout, which refuses fork repo, PR ref, or PR head SHA unless allow-unsafe-pr-checkout is set; the default is a failed step. A run step using gh pr checkout, git fetch, or a fork's artifact is not covered and leads straight to fork code running with secrets." width="960" height="620" loading="lazy" />
  <figcaption>Two guards now sit on the pwn request path. The red line on the right goes around the second one. Sources: <a href="https://github.blog/changelog/2026-11-02-pull_request_target-blocked-by-default-december-2">GitHub changelog</a>, <a href="https://github.com/actions/checkout/blob/v7.0.1/src/unsafe-pr-checkout-helper.ts">actions/checkout source</a>, <a href="https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target">GitHub Docs</a>.</figcaption>
</figure>

## What GitHub turns off on December 2

The [November 2 changelog](https://github.blog/changelog/2026-11-02-pull_request_target-blocked-by-default-december-2) states it plainly: "Starting December 2, 2026, GitHub Actions will block pull_request_target events by default in all public repositories, unless an applicable Actions event policy explicitly allows them."

The scope:

| Repository | Affected |
|---|---|
| Public, on GitHub Free, Team, or Enterprise Cloud, no event policy | Yes, runs are blocked |
| Public, with an event policy that allows `pull_request_target` | No, your policy wins |
| Private or internal | No |
| GitHub Enterprise Server | No |

The rule arrived with [workflow execution protections GA on September 17](https://github.blog/changelog/2026-09-17-workflow-execution-protections-in-github-actions-generally-available/). It has run in evaluate mode since then, which records the runs it would block while the workflows keep running. An October 21 editor's note on that post moved enforcement from November 2 to December 2. During each brownout, blocked attempts "will create failed runs with an error annotation; the workflows won't execute."

<figure>
  <img src="/diagrams/pull-request-target-blocked-checkout-guard-timeline.svg" alt="Timeline. 2026-06-17 actions/checkout v7.0.0 tagged, refusing fork PR checkout in pull_request_target and workflow_run. 2026-07-16 v2 to v6 tags moved to v2.8.0, v3.7.0, v4.4.0, v5.1.0, v6.1.0 with the guard. 2026-09-17 workflow execution protections GA with default rule in evaluate mode. 2026-10-21 enforcement moved from November 2 to December 2. 2026-11-09 and 2026-11-16 brownouts from 16:00 to 18:00 UTC. 2026-12-02 permanent enforcement." width="960" height="602" loading="lazy" />
  <figcaption>The checkout guard shipped five months before the event block. Sources: <a href="https://github.com/actions/checkout/blob/main/CHANGELOG.md">actions/checkout CHANGELOG</a> and tags, GitHub changelog for <a href="https://github.blog/changelog/2026-09-17-workflow-execution-protections-in-github-actions-generally-available/">September 17</a> and <a href="https://github.blog/changelog/2026-11-02-pull_request_target-blocked-by-default-december-2">November 2</a>.</figcaption>
</figure>

## Why pull_request_target is the pwn request trigger

The two pull request triggers differ in one detail. `pull_request` runs the workflow from the PR's merge commit with a read-only token and no secrets. `pull_request_target` runs the workflow file from the base repository's default branch, with the base repository's `GITHUB_TOKEN` and secrets. That is safe as long as no fork code runs.

The [GitHub Docs page on the trigger](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target) shows how teams break it, labeled as insecure:

```yaml
# INSECURE. Provided as an example only.
on:
  pull_request_target:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - name: Test
        run: make test
```

The checkout itself is harmless. The next line is the attack: `make test` runs a `Makefile` from the fork. In the docs' words, "Those commands then run with the base repository's secrets and token." The usual reason for writing this is a test suite that needs a private registry token.

## actions/checkout now refuses fork code

The second guard landed earlier and with less notice. [actions/checkout v7.0.0](https://github.com/actions/checkout/blob/main/CHANGELOG.md) lists "Block checking out fork PR for pull_request_target and workflow_run". The old major tags got it too: `v2`, `v3`, `v4`, `v5`, and `v6` now point at v2.8.0, v3.7.0, v4.4.0, v5.1.0, and v6.1.0, each of which declares the new [`allow-unsafe-pr-checkout` input](https://github.com/actions/checkout/blob/v4.4.0/action.yml). A workflow on `actions/checkout@v4` already has the guard.

The logic lives in [unsafe-pr-checkout-helper.ts](https://github.com/actions/checkout/blob/v7.0.1/src/unsafe-pr-checkout-helper.ts). It only runs when you set `ref` or point `repository` at another repository; a bare `actions/checkout` always resolves to the trusted commit for the event.

<figure>
  <img src="/diagrams/pull-request-target-blocked-checkout-guard-logic.svg" alt="Flowchart of the actions/checkout guard. Pass if allow-unsafe-pr-checkout is true, if repository and ref are defaults, if the event is not pull_request_target or a workflow_run from a PR, or if the PR head repository is not a fork. Otherwise, if repository is the fork, ref is refs/pull/N/head or merge, or commit is the PR head or merge SHA, the step fails with Refusing to check out fork pull request code. Lab case D passes via the opt-in, case E passes because the event is pull_request, cases A and B are refused." width="960" height="630" loading="lazy" />
  <figcaption>Five checks, and only the last one can fail the step. Source: <a href="https://github.com/actions/checkout/blob/v7.0.1/src/unsafe-pr-checkout-helper.ts">actions/checkout v7.0.1</a>.</figcaption>
</figure>

### Lab: the guard against a fake fork PR

The action reads its event from `GITHUB_EVENT_PATH` and its inputs from `INPUT_*` variables, so the built `dist/index.js` from the v7.0.1 tag runs on a laptop. The event below claims a PR from `mallory/app` (repo id 200) into `acme/app` (repo id 100):

```bash
cat > event.json <<'EOF'
{"repository":{"id":100,"full_name":"acme/app"},
 "pull_request":{"number":42,
  "head":{"sha":"1111111111111111111111111111111111111111",
          "repo":{"id":200,"full_name":"mallory/app"}},
  "merge_commit_sha":"2222222222222222222222222222222222222222"}}
EOF

env -i PATH="$PATH" HOME="$PWD" RUNNER_TEMP="$PWD/tmp" \
  GITHUB_WORKSPACE="$PWD/ws" GITHUB_REPOSITORY=acme/app \
  GITHUB_EVENT_NAME=pull_request_target GITHUB_EVENT_PATH="$PWD/event.json" \
  GITHUB_SERVER_URL=https://github.com GITHUB_REF=refs/heads/main \
  GITHUB_SHA=3333333333333333333333333333333333333333 INPUT_TOKEN=x \
  INPUT_REF=1111111111111111111111111111111111111111 \
  node checkout/dist/index.js | grep -v '::debug'
```

Case A, `ref` set to the PR head SHA, fails before any network call:

```text
::save-state name=isPost::true
::error::Refusing to check out fork pull request code from a 'pull_request_target' workflow. This workflow runs with the base repository's GITHUB_TOKEN, secrets, default-branch cache scope, and runner access. Fetching and executing a fork's code in that trusted context commonly leads to "pwn request" vulnerabilities. To opt in, review the risks at https://gh.io/securely-using-pull_request_target and set 'allow-unsafe-pr-checkout: true' on the actions/checkout step.
```

The other runs, same payload:

| Case | Change | Result |
|---|---|---|
| A | `INPUT_REF` = PR head SHA | Refused, exit 1 |
| B | `INPUT_REPOSITORY=mallory/app`, `INPUT_REF=feature` | Refused, exit 1 |
| D | case A plus `allow-unsafe-pr-checkout: true` | Passes, prints `Syncing repository: acme/app` |
| E | case A with `GITHUB_EVENT_NAME=pull_request` | Passes, prints `Syncing repository: acme/app` |

## The gap: a run step skips the checkout guard

The guard watches one action's inputs. The [docs](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target) say so: "Checking out other untrusted code, such as an unrelated third-party repository, fetching code with `git fetch` or `gh pr checkout`, or running a downloaded artifact, is not covered by the `actions/checkout` checks."

Two more ways to miss it:

- **Pinned SHAs.** Pinning `actions/checkout` to a commit is good practice, and it also freezes you on the pre-guard code until Dependabot or Renovate bumps the pin.
- **Other privileged triggers.** The docs note that an `issue_comment` or `workflow_run` workflow that fetches and runs fork code "is vulnerable in the same way". The checkout guard covers `workflow_run`, not `issue_comment`.

So the December 2 event block is the control that does not care how the fork code arrives. Allowing the event in a policy turns that control off for the workflows you target.

## Find every pull_request_target workflow before December 2

In GitHub, open **Settings**, then under **Actions** click **Policies**, and review the runs the default rule would block ([how-to](https://docs.github.com/actions/how-tos/administer/control-workflow-execution)). In a checkout, grep:

```bash
grep -rlE 'pull_request_target|workflow_run|issue_comment' .github/workflows
```

Then let a linter read the steps. Running [zizmor](https://docs.zizmor.sh/audits/#dangerous-triggers) 1.32.0 on the insecure pattern above (with `actions/checkout@v4` and a `REGISTRY_TOKEN` secret) shows, trimmed:

```text
$ zizmor --offline --no-progress --persona=regular .
warning[artipacked]: credential persistence through GitHub Actions artifacts
error[dangerous-triggers]: use of fundamentally insecure workflow trigger
 --> ./.github/workflows/ci.yml:3:3
  |
3 |   pull_request_target:
  |   ^^^^^^^^^^^^^^^^^^^ pull_request_target is almost always used insecurely
error[unpinned-uses]: unpinned action reference
6 findings (3 suppressed, 1 unsafe fixes): 0 informational, 0 low, 1 medium, 2 high
```

## Move to pull_request, or split with workflow_run

If the job only builds and tests, switch the trigger and drop the secret. Same scan on the rewrite:

```yaml
name: ci
on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: make test
```

```text
$ zizmor --offline --no-progress --persona=regular .
No findings to report. Good job! (2 suppressed)
```

If something needs write access after the tests, such as a PR comment with coverage, use the split from GitHub Security Lab's [Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/): an unprivileged `pull_request` workflow uploads results as an artifact, and a `workflow_run` workflow with write access reads them. The second workflow must treat the artifact as data. Parse it, never execute it, and never feed it to a shell unquoted. The [testmetest hook backdoor post](/testmetest-ai-hook-backdoors/) shows what happens when tooling runs files from a repository nobody reviewed.

## If a workflow has to keep pull_request_target

Labelers and triage bots that never touch fork code are the legitimate case. Create an event policy that allows `pull_request_target` and use workflow file targeting so it covers only those files. Then:

- Set `permissions:` to the minimum the job needs.
- Pass only the secrets that job uses.
- Know that these runs get read-only access to the default branch's cache, so a cache save fails with a warning. Do not add a write-capable `cache-mode`; the docs say it "reintroduces the cache-poisoning risk".
- Never add `allow-unsafe-pr-checkout: true` unless the checked-out code is only read as data.

## What to do

1. Before 16:00 UTC today, open the Actions policies page on each public repository and list the workflows the default rule would block.
2. Run `grep -rlE 'pull_request_target|workflow_run|issue_comment' .github/workflows` and zizmor on every repository, public or private.
3. Move build and test jobs to `pull_request`, removing the secrets they no longer get.
4. Rewrite jobs that need write access as a `pull_request` plus `workflow_run` pair that only reads artifacts as data.
5. For the few workflows that must keep the trigger, add an event policy scoped by workflow file, minimal `permissions:`, and no fork checkout.
6. Bump pinned `actions/checkout` SHAs to a guarded release such as v7.0.1, and search `run:` steps for `gh pr checkout` and `git fetch` in privileged jobs.
