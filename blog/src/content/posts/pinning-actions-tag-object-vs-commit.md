---
title: "Pinning a GitHub Action to a tag object instead of its commit"
description: "The first blog deploy failed on a SHA-pinned action. The pin was a tag object, and the release had no dist/. How to resolve a tag to its commit and check every pin."
date: 2026-09-23T01:10:00Z
tags: [github-actions, security, ci, git]
takeaways:
  - "An annotated Git tag has its own object SHA; pinning that SHA instead of the commit breaks a GitHub Action."
  - "git ls-remote shows the commit on the line ending in ^{}; a lightweight tag has only one line, and that SHA is the commit."
  - "A JavaScript action runs the file named in runs.main from the pinned tree, and nothing builds it for you."
  - "If an action only wraps a CLI, call the CLI at a pinned version and drop the action."
  - "A short script can check that every pinned SHA matches the commit for the tag in its version comment."
---

Every action in this repo is pinned to a full SHA with the version in a trailing comment. The first deploy of this blog failed on one of those pins. The SHA I had pinned was not a commit. It was an annotated tag object. And the commit behind it would not have worked either.

## The failure

The original deploy step used Cloudflare's action:

```yaml
- name: Deploy to Cloudflare Pages
  if: steps.cf.outputs.ready == 'true'
  uses: cloudflare/wrangler-action@1fe0517c9eb0b72d7f3cb0aba71a3d7719487ea6 # v4.1.1
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    wranglerVersion: "4.136.3"
    # Creates the Pages project on first run; "already exists" after that is fine.
    preCommands: npx wrangler pages project create ${{ env.PROJECT }} --production-branch=main || true
    command: pages deploy blog/dist --project-name=${{ env.PROJECT }} --branch=main
```

The job died before Wrangler ran, with `File not found: .../wrangler-action/1fe0517.../dist/index.mjs`.

## Two kinds of tag

Git has two kinds of tag. A lightweight tag is a ref that points straight at a commit. An annotated tag is a separate object in the repo, with its own SHA, a tagger, a date, and a message. The ref points at the tag object, and the tag object points at the commit.

`git ls-remote` shows the difference. For an annotated tag it prints two lines: the tag object, and the commit after the `^{}` suffix, which Git calls the peeled value.

```bash
$ git ls-remote https://github.com/cloudflare/wrangler-action 'refs/tags/v4.1.1*'
1fe0517c9eb0b72d7f3cb0aba71a3d7719487ea6	refs/tags/v4.1.1
4e88846969242f7752bcfdaf5511bfbb3985ca47	refs/tags/v4.1.1^{}
```

The first SHA is the one I pinned. Fetching the tag and asking Git confirms what it is:

```bash
$ git cat-file -t 1fe0517c9eb0b72d7f3cb0aba71a3d7719487ea6
tag
$ git cat-file -p 1fe0517c9eb0b72d7f3cb0aba71a3d7719487ea6 | head -4
object 4e88846969242f7752bcfdaf5511bfbb3985ca47
type commit
tag v4.1.1
tagger github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com> 1790098177 +0000
```

The `actions/*` tags this repo uses are lightweight. `git ls-remote` returns one line for each, and that SHA is the commit. Copying the first SHA works for them and gives the wrong object for an annotated tag. The two cases look the same until you check.

## The commit had no dist/ either

The tag object was only half of it. The action's `action.yml` on the v4.1.1 commit says:

```yaml
runs:
  using: "node24"
  main: "dist/index.mjs"
```

The tree of that commit has no `dist/` directory:

```bash
$ git ls-tree --name-only 4e88846969242f7752bcfdaf5511bfbb3985ca47
.changeset
.github
.gitignore
.prettierignore
.prettierrc
CHANGELOG.md
CODEOWNERS
CONTRIBUTING.md
LICENSE-APACHE
LICENSE-MIT
README.md
action.yml
package-lock.json
package.json
src
tsconfig.json
```

v4.1.0 is the same: source only, no `dist/`. The v4.0.0 tag is lightweight and its commit holds exactly two entries, `action.yml` and `dist`. So pinning the correct commit for v4.1.1 would have failed with the same missing file. A JavaScript action runs whatever file `runs.main` names in the checked-out tree, and nothing builds it for you.

The v4.1.1 tag object is dated 2026-09-22 17:29 UTC. The fix landed in this repo the same day.

## The fix: drop the action

Two options were on the table: pin an older major that ships `dist/`, or remove the action. The commit that fixed it went with removal and runs Wrangler from npm at a pinned version:

```yaml
# Wrangler runs straight from npm at a pinned version: no third-party
# action in the path, and the version is explicit and reviewable.
- name: Deploy to Cloudflare Pages
  if: steps.due.outputs.run == 'true' && steps.cf.outputs.ready == 'true'
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    WRANGLER: wrangler@4.136.3
  run: |
    if npx --yes "$WRANGLER" pages project list | grep -qw "$PROJECT"; then
      echo "Pages project $PROJECT exists."
    else
      npx --yes "$WRANGLER" pages project create "$PROJECT" --production-branch=main
    fi
    npx --yes "$WRANGLER" pages deploy blog/dist --project-name="$PROJECT" --branch=main --commit-dirty=true
```

The action was a wrapper around a CLI that the job can call directly. Removing it takes one third-party repo out of the path that holds the Cloudflare token.

The rewrite also fixed a second problem in the old step. `pages project create ... || true` was there so "already exists" would not fail the job. It also hid every other error from that command, including a bad token. Now the step lists projects first and only creates one when it is missing. If the token is wrong, the list prints nothing the `grep` can match, so the step goes on to `pages project create`. That call fails too, and since `run:` steps use `bash -e` by default, the step stops there with Wrangler's error in the log instead of a swallowed one.

## Resolving a tag to its commit

Any of these give the commit, whatever kind of tag it is:

| Method | Command | Works without a clone |
| --- | --- | --- |
| ls-remote, peeled line | `git ls-remote <repo> 'refs/tags/v1.2.3^{}'`, falling back to the plain ref for a lightweight tag | Yes |
| rev-parse after a fetch | `git rev-parse 'v1.2.3^{commit}'` | No |
| GitHub commits API | `GET /repos/{owner}/{repo}/commits/v1.2.3`, then read `sha` | Yes |

The `^{commit}` suffix tells Git to follow tag objects until it reaches a commit. On a lightweight tag it is a no-op. Git documents both suffixes in [gitrevisions](https://git-scm.com/docs/gitrevisions). The GitHub endpoint is [Get a commit](https://docs.github.com/en/rest/commits/commits#get-a-commit), which accepts a tag name as the ref.

## Checking every pin

This script walks every `uses:` line with a 40-character SHA and a version comment, looks up the tag on GitHub, and compares:

```bash
#!/usr/bin/env bash
# For each SHA-pinned action, check the SHA is a commit (not a tag object)
# and that it matches the tag named in the trailing comment.
set -euo pipefail
grep -hoE 'uses: [^ ]+@[0-9a-f]{40} # v[0-9.]+' .github/workflows/*.yml | sort -u |
while read -r _ ref _ tag; do
  repo=${ref%@*} sha=${ref#*@}
  refs=$(git ls-remote "https://github.com/$repo" "refs/tags/$tag" "refs/tags/$tag^{}")
  commit=$(awk -v t="refs/tags/$tag^{}" '$2==t {print $1}' <<<"$refs")
  [ -n "$commit" ] || commit=$(awk '{print $1; exit}' <<<"$refs")
  if [ "$sha" = "$commit" ]; then
    echo "ok    $repo $tag"
  else
    echo "FAIL  $repo $tag: pinned $sha, commit is ${commit:-missing}"
  fi
done
```

On the current workflows every pin passes:

```text
ok    actions/checkout v7.0.1
ok    actions/configure-pages v6.0.0
ok    actions/deploy-pages v5.0.1
ok    actions/setup-node v7.0.0
ok    actions/upload-pages-artifact v5.0.0
```

Run against `blog.yml` as it was before the fix, it catches the bad pin:

```text
ok    actions/checkout v7.0.1
ok    actions/setup-node v7.0.0
FAIL  cloudflare/wrangler-action v4.1.1: pinned 1fe0517c9eb0b72d7f3cb0aba71a3d7719487ea6, commit is 4e88846969242f7752bcfdaf5511bfbb3985ca47
```

It only covers the first problem. A correct commit pin with no `dist/` still passes. For that, fetch the pinned commit and check that the file named in `runs.main` exists in its tree before trusting a new version. `git ls-tree <sha> dist/` returning nothing is enough to know it will fail.

## Checklist for a new pin

- Take the commit, not the first SHA. For an annotated tag that means the `^{}` line.
- Keep the version comment. The `github-actions` ecosystem in `.github/dependabot.yml` opens PRs that bump both the SHA and the comment.
- For a JavaScript action, confirm the `runs.main` file exists in the pinned tree.
- If an action only wraps a CLI, call the CLI at a pinned version and drop the action.
