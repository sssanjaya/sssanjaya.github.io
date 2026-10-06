---
title: "@subql/common 5.8.3: npm trusted publishing from a side branch"
description: "@subql/common 5.8.3 shipped a credential stealer from an unmerged branch's publish workflow. Check your exposure, then close the same npm publish gap."
date: 2026-10-06T10:08:34Z
tags: [npm, supply-chain, github-actions, devsecops, security]
takeaways:
  - "@subql/common 5.8.3 was published to npm on October 5, 2026 with a payload that steals CI and cloud credentials and supports remote shell access."
  - "A test release from the same unmerged branch published through npm trusted publishing, and its provenance names that branch instead of main."
  - "npm trusted publishing for GitHub Actions matches the repository and workflow file name, so any branch that can run that file can publish unless an environment is also required."
  - "Running npm with --ignore-scripts does not make @subql/common 5.8.3 safe, because importing the package also starts the payload."
  - "The provenance attestation records the branch a package was built from, so a release built from a non-release branch is visible to anyone who reads it."
---

On October 5, 2026, `@subql/common` 5.8.3 shipped to npm with a payload that steals credentials and supports remote shell access, according to [StepSecurity's analysis](https://www.stepsecurity.io/blog/subql-ecosystem-compromised). If any project, laptop, or CI (continuous integration) runner of yours installed or imported 5.8.3, treat it as compromised and rotate what it could reach. If you publish npm packages with trusted publishing, the way this release got out applies to you too: it came from a publish workflow on an unmerged branch, and a test release from that branch went through the normal OIDC (OpenID Connect) trusted publishing path.

## What happened on October 5

`@subql/common` is a shared library in the SubQuery indexing framework. StepSecurity's timeline, all in UTC:

| Time | Event |
|---|---|
| 11:23:01 | Branch `chore/ci-audit-55` created in `subquery/subql` by the account `ianhe8x` |
| 11:23:03 | Commit replaces `publish.yml` with a "Red Team Canary (harmless)" job |
| 11:24:40 | Test release `5.8.3-onf-rt1` published under the `redteam` dist-tag |
| 11:27:17 | Branch deleted |
| 11:52:38 | Same branch name created again |
| 11:52:41 | Commit `506863d6fb82` adds a step that swaps in a tarball from `ci-artifacts.dev` |
| 11:56:29 | `@subql/common` 5.8.3 published with the payload |

StepSecurity is careful about who did this: "These records identify the account and metadata associated with the activity, not the person controlling the account or whether the activity was authorized." It also notes that `main` still pointed to the parent commit at collection time, so neither change was merged.

Per StepSecurity, the second commit changed the release job to allow `workflow_dispatch` and added a step that downloads `https://ci-artifacts.dev/pkg/@subql-common-5.8.3.tgz` over the built package. The report says there is "no hash or signature verification of that external archive in the added step." The repo's own publish action then ran `yarn npm publish`.

StepSecurity opened [issue #3047](https://github.com/subquery/subql/issues/3047) on the SubQuery repo the same day. When checked at 10:07 UTC on October 6, 2026, the [npm registry](https://registry.npmjs.org/@subql%2fcommon) returned 404 for 5.8.3 and `latest` pointed to 5.8.2. The test build `5.8.3-onf-rt1` was still listed. This is still developing.

## What the payload does

From the StepSecurity write-up:

- The payload lives in `dist/project/readers/manifest-cache.js`. It runs at install and again when the package is imported.
- It reads `.npmrc`, `.env`, AWS credentials, SSH keys, kubeconfig, and cloud caches, plus the full process environment and `gh auth token`.
- On Linux GitHub Actions runners, it reads the `Runner.Worker` process memory through `/proc` to find secrets.
- It tries AWS Secrets Manager, SSM Parameter Store, Kubernetes service account secrets, and Vault, where permissions allow.
- With a usable GitHub token, it creates the branch `dependabot/github_actions/format/setup-formatter` with `.github/workflows/codeql_analysis.yml`. That workflow dumps `toJSON(secrets)` into an artifact, then the payload tries to delete the run and the branch.
- It sends encrypted data to `https://ci-artifacts.dev/router` and supports remote shell access.

Two lines from the report matter for cleanup: "Disabling install scripts alone is insufficient because importing the package also starts the payload." And: "Uninstalling alone does not stop a detached worker."

You may be exposed without depending on `@subql/common` directly. StepSecurity points out, and `npm view` confirms, that `@subql/cli` 6.6.3 and `@subql/node-core` 19.3.1 depend on `~5.8.2`, and `@subql/query` 2.25.0 on `~5.8.1`. These ranges accept 5.8.3. A fresh `npm install` without a lockfile during the window would pull it.

## How trusted publishing let a side branch publish

The test commit [`34128fd`](https://github.com/subquery/subql/commit/34128fd8cdc95a1dfddb52f99ceeec362aadd711) cut `publish.yml` down to one job. It keeps `id-token: write`, runs only on `workflow_dispatch`, repacks 5.8.2 under a new version, and runs `npm publish`. That was enough.

The [npm trusted publishers docs](https://docs.npmjs.com/trusted-publishers) list three required fields for GitHub Actions: organization or user, repository, and workflow file name. The environment name is optional: "If using GitHub environments for deployment protection". There is no branch field. So a token from any branch that runs a file named `publish.yml` in that repository matches the publisher, unless an environment is also required.

The [provenance attestation](https://registry.npmjs.org/-/npm/v1/attestations/@subql%2fcommon@5.8.3-onf-rt1) for the test build shows exactly this:

```json
"workflow": {
  "ref": "refs/heads/chore/ci-audit-55",
  "repository": "https://github.com/subquery/subql",
  "path": ".github/workflows/publish.yml"
}
```

The `event_name` in the same record is `workflow_dispatch`. Neither the original `publish.yml` on `main` nor the test job declares an `environment:`. Since the test job published without one, the npm publisher config for this package could not have required one.

Provenance did not block the release. It did record where the release came from. In a scratch project with `5.8.3-onf-rt1` installed, `npm audit signatures` (npm 10.9.4) passed:

```text
131 packages have verified registry signatures

5 packages have verified attestations
```

A valid attestation proves the package came from that repository's workflow. It does not prove the workflow ran on your release branch.

![The 5.8.3 publish path on October 5, 2026, with the control that blocks each step: environment branch rule, required reviewers, environment name on the npm publisher, stage-only publishing, and lockfiles with a provenance ref check](/diagrams/subql-npm-trusted-publishing-path.svg)

## What to check if you use SubQuery packages

1. Find the version in every lockfile and image:

   ```bash
   npm ls @subql/common --all
   grep -rn --include=package-lock.json --include=yarn.lock --include=pnpm-lock.yaml '@subql/common' .
   ```

2. Look for the payload file and lock file on hosts and runners:

   ```bash
   find / -path '*@subql/common/dist/project/readers/manifest-cache.js' 2>/dev/null
   ls -la "${TMPDIR:-/tmp}"/tmp.ts018051808.lock 2>/dev/null
   ```

3. Search DNS and proxy logs for `ci-artifacts.dev`, and block it.
4. In each GitHub repo the exposed token could write to, list runs on the injected branch, even if the branch is gone:

   ```bash
   gh api "repos/OWNER/REPO/actions/runs?branch=dependabot/github_actions/format/setup-formatter" \
     --jq '.workflow_runs[] | [.created_at, .name, .actor.login] | @tsv'
   ```

   The payload tries to delete runs too, so an empty result is not proof. Check the org audit log where you have one.
5. If 5.8.3 was installed or imported anywhere, follow StepSecurity's steps: isolate the host, keep evidence, rebuild from a trusted image, and rotate npm, GitHub, cloud, SSH, Kubernetes, and Vault credentials it could reach. Pin `@subql/common` to 5.8.2 in your lockfile. StepSecurity found the payload absent from the 5.8.2 tarball.

StepSecurity lists file hashes for the tarball and loader. Use those to match artifacts you saved.

## How to lock down your own npm publish path

These steps come from the [npm trusted publishers docs](https://docs.npmjs.com/trusted-publishers) and GitHub's [deployments and environments reference](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

1. **Put the publish job in an environment.**

   ```yaml
   jobs:
     publish:
       runs-on: ubuntu-latest
       environment: npm-publish
       permissions:
         id-token: write
         contents: read
   ```

2. **Limit that environment to `main` or your release tags.** Use "Selected branches and tags". GitHub matches the rule "against the `GITHUB_REF` of the workflow run", so a run from `chore/ci-audit-55` cannot use it. Avoid "Protected branches only" if you have no protection rules: "If no branch protection rules are defined for any branch in the repository, then all branches can deploy."
3. **Require a reviewer and turn on "prevent self-reviews".** With that on, "users who initiate a deployment cannot approve the deployment job". Also turn off the default that lets administrators bypass the rules. On GitHub Free, Pro, and Team plans, required reviewers work only in public repositories.
4. **Enter the environment name on the npm trusted publisher.** If the npm publisher has no environment name, a workflow without an `environment:` line still publishes, as the test job above did.
5. **Use stage-only publishing.** npm says a stage-only publisher sends every CI publish through the staged flow, where a maintainer signs off with two-factor authentication (2FA), "requiring a maintainer to review and approve each package with 2FA via the CLI or npmjs.com before it becomes publicly available." GitHub access alone does not give that approval.
6. **Set "Require two-factor authentication and disallow tokens"** under the package's publishing access settings, and revoke old automation tokens.

## How to check provenance refs on what you install

`npm audit signatures` verifies signatures but does not print the source branch. This script reads each package in `package-lock.json` and prints the ref, trigger, and workflow from its SLSA (Supply-chain Levels for Software Artifacts) provenance. It uses only Node built-ins (tested on Node 22):

```javascript
// provenance-refs.mjs: print the source ref of each package's npm provenance
import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
for (const [path, meta] of Object.entries(lock.packages ?? {})) {
  if (!path.startsWith("node_modules/") || !meta.version) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + 13);
  const url = `https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent(name)}@${meta.version}`;
  const res = await fetch(url);
  if (!res.ok) continue; // no provenance published
  const { attestations } = await res.json();
  for (const a of attestations) {
    if (a.predicateType !== "https://slsa.dev/provenance/v1") continue;
    const stmt = JSON.parse(Buffer.from(a.bundle.dsseEnvelope.payload, "base64").toString());
    const wf = stmt.predicate.buildDefinition.externalParameters.workflow;
    const ev = stmt.predicate.buildDefinition.internalParameters?.github?.event_name;
    console.log(`${name}@${meta.version}\t${wf.ref}\t${ev}\t${wf.path}`);
  }
}
```

Output from the scratch project:

```text
@subql/common@5.8.3-onf-rt1	refs/heads/chore/ci-audit-55	workflow_dispatch	.github/workflows/publish.yml
axios@1.20.0	refs/tags/v1.20.0	push	.github/workflows/publish.yml
semver@7.8.5	refs/heads/main	push	.github/workflows/release.yml
validator@13.15.35	refs/tags/13.15.35	release	.github/workflows/npm-publish.yml
```

The script decodes the attestation without checking its signature, so run `npm audit signatures` first. Then flag any ref that is not your upstream's default branch or a tag, and review it before you merge the dependency update. A ref like `refs/heads/chore/ci-audit-55` on a release is the signal this incident left behind.
