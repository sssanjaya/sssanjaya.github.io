---
title: "package-lock.json churn: npm 10 drops npm 11's libc fields"
description: "Running npm 10 on a package-lock.json written by npm 11 deletes every libc field. Regenerate with npx npm@11 install and pin the version Dependabot proposed."
date: 2026-09-26
tags: [npm, dependabot, git, ci]
takeaways:
  - "Running npm install with npm 10.9.7 on a lockfile written by npm 11 removes every libc field, even when no dependency changed."
  - "npx npm@11 install regenerates the lockfile with the same npm major that wrote it, so the diff shows only the real change."
  - "npm ci does not rewrite package-lock.json, so an older npm can still install from a lockfile a newer npm wrote."
  - "To resolve a lockfile merge conflict, take the base branch's lockfile and reinstall the exact version the pull request proposed."
  - "A plain npm install after taking the base lockfile resolves the caret range to the newest matching release, which nobody reviewed."
---

If `npm install` rewrites dozens of `package-lock.json` lines that have nothing to do with your change, check which npm wrote the lockfile. On this repo, npm 10 deletes the `libc` fields that npm 11 writes, so every install with the older npm shows up as churn. The fix is to run the same major that wrote the file: `npx npm@11 install`. The same rule, plus installing an exact version, resolved a Dependabot lockfile conflict without pulling in a release nobody had reviewed.

## What npm 10 removes from an npm 11 lockfile

The lockfile in this repo has `"lockfileVersion": 3`. It carries 38 `libc` arrays, one on each platform-specific optional package that targets Linux: `@img/*` (the [sharp](https://sharp.pixelplumbing.com/) binaries), `@rolldown/*`, `@astrojs/*`, `@resvg/*`, `lightningcss-linux-*`, and a few more. Each entry says which C library the binary is built for:

```json
"cpu": [
  "arm64"
],
"libc": [
  "glibc"
],
"license": "MIT",
"optional": true,
```

The value comes from the [`libc` field](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#libc) in each package's own `package.json`. To see the churn, copy the current `package.json` and `package-lock.json` into two empty directories and run a lockfile-only install in each, with no dependency changes:

```bash
npm install --package-lock-only --ignore-scripts          # npm 10.9.7
npx npm@11 install --package-lock-only --ignore-scripts   # npm 11.20.0
```

npm 11.20.0 left the file byte-identical. npm 10.9.7 produced this:

```text
package-lock.json | 114 ---------------------
1 file changed, 114 deletions(-)
```

That is 38 fields at 3 lines each. Every hunk looks like the one above with the `libc` block gone. No version, `resolved` URL, or `integrity` hash changed. The dependency tree is the same, but a reviewer sees 114 deleted lines and has to prove that to themselves.

Running npm 11 afterwards does not undo it. A lockfile-only `npx npm@11 install` on the npm 10 output left the count at 0. Restoring them means starting again from the committed lockfile, not running a newer npm over the damaged one.

## Regenerating the lockfile with npx npm@11

Node 22.22.2 ships with npm 10.9.7, so the bundled npm is the older major. The lockfile on `main` has the npm 11 fields, and so did the Dependabot commits: the Astro bump Dependabot pushed carried 34 `libc` arrays.

[`npx`](https://docs.npmjs.com/cli/v11/commands/npx) runs a given npm version without replacing the global one:

```bash
npx npm@11 install
git diff --stat package-lock.json
```

Only the lines for the dependency you changed should appear in the diff. A quick check before you commit is whether the `libc` count went down:

```bash
grep -c '"libc"' package-lock.json
```

CI does not have this problem. The site and blog [workflows](https://docs.github.com/en/actions) set up Node 22 with `actions/setup-node` and run `npm ci --ignore-scripts`. [`npm ci`](https://docs.npmjs.com/cli/v11/commands/npm-ci) installs from the lockfile and does not write it. Run with npm 10.9.7 on the npm 11 lockfile, it installed with `found 0 vulnerabilities` and left `git status` clean. The churn only happens on commands that write the lockfile, such as `npm install` and `npm update`.

## Resolving a Dependabot package-lock.json conflict

The Astro pull request from [Dependabot](https://docs.github.com/en/code-security/dependabot) bumped `astro` from 7.1.3 to 7.2.8. By the time it was ready to merge, `main` had six Dependabot bumps the Astro branch did not include: svgo, smol-toml, sharp, js-yaml, devalue, and nanoid. Each one rewrote parts of `package-lock.json`. Merging `main` into the Astro branch then stopped on one file:

```text
Auto-merging package-lock.json
CONFLICT (content): Merge conflict in package-lock.json
```

`package.json` merged cleanly. Hand-editing conflict markers in a generated lockfile is the wrong fix, because the result has to match what npm would resolve. The resolution in the merge commit was to take `main`'s lockfile and install exactly the version the pull request proposed, with npm 11:

```bash
git merge origin/main
git checkout --theirs package-lock.json   # main's side of the merge
npx npm@11 install astro@7.2.8
git add package.json package-lock.json
git commit
```

During a merge, `--theirs` is the branch being merged in, here `main` ([`git checkout`](https://git-scm.com/docs/git-checkout#Documentation/git-checkout.txt---theirs) docs). The merge commit changed 50 lines of `package-lock.json` against the Dependabot commit, and `npm audit` reported 0 vulnerabilities afterwards.

## Why install astro@7.2.8 and not just npm install

After the merge, `package.json` asks for `"astro": "^7.2.8"`, and `main`'s lockfile still locks `astro` at 7.1.3. That locked version no longer satisfies the range, so npm has to pick a new one. A plain [`npm install`](https://docs.npmjs.com/cli/v11/commands/npm-install) picks the newest release that matches `^7.2.8`.

This reproduces with the two files from that merge. A plain `npx npm@11 install --package-lock-only` resolved `astro` to 7.3.5, the newest release in the registry at the time of writing. At the time of the merge the newest match was 7.3.4, published about an hour before the merge commit. Either way the result is a minor version that the pull request never proposed and nobody had reviewed.

`npx npm@11 install astro@7.2.8` on the same files resolved `astro` to 7.2.8 and kept `^7.2.8` in `package.json`, because npm saves with a caret prefix by default. The lockfile then pins 7.2.8, and `npm ci` installs exactly that until someone changes it on purpose.

| Command after taking main's lockfile | astro in lockfile | What it means |
| --- | --- | --- |
| Edit the conflict markers by hand | Whatever the edit produced | Not what npm would resolve |
| `npx npm@11 install` | Newest match for `^7.2.8` | A version the pull request did not propose |
| `npx npm@11 install astro@7.2.8` | 7.2.8 | Exactly what the pull request proposed |

## The check before merging

Two checks cover it. The lockfile diff should change nothing besides the dependency in the pull request, and the resolved version should be the one the pull request named. `git diff --stat` answers the first. For the second:

```bash
npm ls astro
```

For this site I also pixel-diffed the built pages before and after the upgrades, which [Proving an npm upgrade changed nothing with pixelmatch](/pixel-diff-dependency-upgrades/) covers. [Hardening a static site](/hardening-a-static-site/) lists the rest of the Dependabot upgrades that merged alongside this one.
