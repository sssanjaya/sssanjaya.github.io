---
title: "GitHub Actions workflow lockfiles: what changes and breaks"
description: "GitHub Actions lockfiles entered public preview Oct 14. They pin actions to commits in actions.lock. Check allowlists, pilot in Evaluate mode, add --verify."
date: 2026-10-15T10:05:16Z
tags: [github-actions, github, supply-chain, ci-cd, devsecops]
takeaways:
  - "GitHub Actions workflow dependency lockfiles entered public preview on October 14, 2026, for GitHub Enterprise Cloud, Enterprise Cloud with data residency, Team, and Free plans."
  - "The gh actions-lock CLI extension writes .github/workflows/actions.lock, which pins every action, including transitive actions, to a commit plus the source repository's numeric owner and repo IDs."
  - "For an onboarded workflow, the runner executes the locked commit even if the tag or branch has moved, and blocks the run if a dependency is missing from the lockfile."
  - "After onboarding, allowed-actions policies are checked against locked SHAs, so allowlist entries pinned to a tag such as actions/checkout@v6 stop matching."
  - "Run gh actions-lock --verify as a pull request check and add actions.lock to CODEOWNERS, because a lockfile only protects you if someone reviews its diff."
---

GitHub put workflow dependency lockfiles for GitHub Actions into public preview on October 14, 2026. A new file, `.github/workflows/actions.lock`, pins every action a workflow uses to a commit, and the runner executes that commit even if the tag moves. Teams on Enterprise Cloud, Team, or Free can try it now, but check your allowed-actions list first, because tag-based allowlist entries stop matching after onboarding.

## What GitHub shipped on October 14

The [GitHub changelog](https://github.blog/changelog/2026-10-14-github-actions-workflow-lockfiles-in-public-preview/) says lockfiles "are now in public preview for GitHub Enterprise Cloud, GitHub Enterprise Cloud with data residency, Team, and Free plans." It states the problem directly: "If an action is compromised, a moved tag or branch can introduce malicious code into your workflow without a change to your repository."

Three pieces arrived together:

| Piece | What it does |
| --- | --- |
| `gh actions-lock` | GitHub CLI (command line interface) extension that generates and checks `actions.lock` |
| Runner enforcement | An onboarded workflow must have lockfile entries for all its dependencies and runs the recorded commits |
| Require lockfile policy | Lets enterprise, organization, and repository admins block workflows that are not onboarded |

Dependabot also understands the file. Per the changelog, when it opens a version update for an action in an onboarded workflow, "it also regenerates the matching lockfile entry in the same pull request."

The [gh-actions-lock README](https://github.com/github/gh-actions-lock) marks the tool as pre-1.0: "The lockfile format, command flags, and behavior may change without notice between releases." It also says "GitHub Enterprise Server (GHES) is not supported." The latest tag, `v0.2.0`, points to a commit from October 12, 2026. Flags in this post match `gh actions-lock --help` from that tag, built from source; they may change before general availability (checked October 15, 2026).

## Why pinning tags was not enough

A tag is a pointer the action's owner can move. In March 2025 that happened to `tj-actions/changed-files`. Its [CVE-2025-30066 record](https://cveawg.mitre.org/api/cve/CVE-2025-30066) says: "The tags v1 through v45.0.7 were affected on 2025-03-14 and 2025-03-15 because they were modified by a threat actor to point at commit 0e58ed8, which contained malicious updateFeatures code."

The standard defense was pinning each `uses:` line to a full commit SHA. That works for direct references only. GitHub's [2026 Actions security roadmap](https://github.blog/news-insights/product-news/whats-coming-to-our-github-actions-2026-security-roadmap/) puts it this way: "Using immutable commit SHAs helps, but it's hard to manage at scale and transitive dependencies remain opaque." A composite action you pin by SHA can still call another action by tag.

The [lockfile concepts page](https://docs.github.com/actions/concepts/security/workflow-dependency-lockfiles) says that for repositories that adopt a lockfile, "SHA pinning within workflow files is no longer necessary," because the lockfile covers transitive dependencies and records the identity of the source repository. A SHA in a file is also only as good as the code that resolves it. The [Claude Code plugin SHA pin bypass](/claude-code-plugin-sha-pin-bypass/) is one example where a branch named after a SHA defeated a pin.

## What actions.lock records and enforces

The file has two sections. `workflows` lists the dependencies of each onboarded workflow. `dependencies` maps each reference to a commit. The docs show this shape:

```yaml
dependencies:
    'octo-org/deploy-action@v3.1.0':
        ref: 'v3.1.0'
        commit: 'sha1-...'
        owner_id: 44036562
        repo_id: 197814629
```

`owner_id` and `repo_id` are numeric IDs. GitHub uses them "to confirm at run time that the repository behind the name is still the one you locked." A repository that was renamed or transferred no longer matches, so its name cannot serve new code under an old reference.

The docs add two limits. The locked commit "must exist within a branch of the source repository," which the README says is meant "to make impostor commit style attacks harder." And a reusable workflow called from another repository "is covered by the lockfile of the repository where it is defined," not by yours.

![Five checks for an onboarded workflow: every uses dependency has a lockfile entry, owner and repo IDs match, the locked commit exists on a branch, full-version tags still point at it, and allowed-actions policies check the locked SHA. Any failure blocks the run.](/diagrams/github-actions-lockfiles-checks.svg)

The README describes the job-start checks: "the repository was not renamed or transferred, the pinned commit still exists, and full-version tags (e.g. `v4.2.1`) still point at it. A failed check blocks the run."

## What breaks when you onboard a workflow

**Allowed-actions lists.** The [how-to guide](https://docs.github.com/en/actions/how-tos/secure-your-work/lock-workflow-dependencies) warns that after onboarding, "the allowlist is checked against locked commit SHAs." It continues: "Entries pinned to a tag, such as actions/checkout@v6, no longer match. Use a wildcard or the full commit SHA instead." Fix the allowlist before you merge the lockfile, or onboarded workflows will fail policy checks.

**Workflow files get rewritten.** The tool narrows partial versions. Per the guide, `octo-org/deploy-action@v3` "can become `octo-org/deploy-action@v3.1.0`." Same-repository `uses: ./…` references become `uses: $/…`, in workflows and in in-repo `action.yml` files. Pass `--no-narrow` or `--no-migrate-local-actions` to skip either rewrite. Read the full diff, not only the lockfile.

**Branch and major-version refs stop moving.** A ref like `main` or `v4` is locked to the commit it had when you ran the tool. A normal run does not advance it. Use `gh actions-lock --relock` to pick up legitimate upstream moves. If the locked commit is gone upstream, for example after a force-push, `--relock` still errors, and you need `--relock --accept-moved`. Treat that second case as a signal to look at the upstream history first.

**Dependabot will not onboard new workflows.** The guide says: "If it bumps a dependency in a workflow with no lockfile entry, it just reports that onboarding is required."

**Evaluate mode is Enterprise only.** The [enforcement guide](https://docs.github.com/en/actions/how-tos/administer/enforce-workflow-lockfiles) says "Evaluate mode for policies is only available on GitHub Enterprise." On other plans there is no Evaluate mode, so pilot with a narrow repository and workflow scope instead.

## What to do this week

1. **Inventory your allowlist.** List tag-pinned entries in your organization's allowed-actions setting and plan wildcard or SHA entries for them.
2. **Start with shared reusable workflows.** The guide recommends onboarding repositories that define shared workflows first, since callers rely on those lockfiles.
3. **Enable Dependabot for Actions** before generating the lockfile, so version bumps keep the file current.
4. **Generate and review.** Run `gh extension install github/gh-actions-lock`, then `gh actions-lock` from the repository root. Use `gh actions-lock .github/workflows/ci.yml` to onboard one workflow at a time.
5. **Add a verify check on pull requests.** `gh actions-lock --verify` writes nothing and, per the help text, "fails if the lockfile is incomplete or the runner would reject a pin." The enforcement guide says it exits with an error on a stale lockfile, "making it useful for a required check."
6. **Add a pre-commit hook.** The guide suggests `gh actions-lock --verify-local --no-fix`. It runs offline with no authentication, but it only checks coverage, not whether the pins are trustworthy.
7. **Route lockfile changes to reviewers.** Add `.github/workflows/actions.lock` to CODEOWNERS and require code owner approval. The guide says a changed `owner_id` or `repo_id` "means the repository behind that name is not the one you originally locked, so investigate before you merge."
8. **Pilot the policy.** Scope Require lockfile to onboarded repositories and workflows. On GitHub Enterprise, run it in Evaluate mode and review which runs it would block before switching to Active.

Here is what `--verify-local` prints for a repository whose three workflows have no lockfile yet, from `v0.2.0` built from source:

```text
3 of 3 workflows failed: 9 not-pinned
5 actions are pinned to a bare SHA without a tag ref
↳ run `gh actions-lock` to pin to tagged releases
```

The second line matters for repos that already SHA-pin: the tool flags bare-SHA references and points you to tagged releases, with the commit kept in the lockfile.

## Limits to keep in mind

The changelog is direct: "Locking does not determine whether the dependency itself is safe, so review dependencies before locking them." If you lock a commit that is already malicious, the lockfile keeps running it. A lockfile also does nothing for workflows that are not onboarded, which is why the policy and the verify check matter.

Lockfiles cover what runs in CI, not what CI publishes. The [@subql/common npm trusted publishing compromise](/subql-npm-trusted-publishing-compromise/) came from a workflow file edited on a side branch, a path that lockfiles do not address. Keep environment protection rules and branch restrictions on release workflows alongside this.
