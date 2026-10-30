---
title: "Claude Code 2.1.314 Write Fence: What Bash Still Gets Past"
description: "Claude Code 2.1.314 adds blockWritesOutsideWorkingDirectories. Twelve lab runs show it beats allow rules and symlinks, and where Bash still writes."
date: 2026-10-30T10:17:59Z
tags: [claude-code, security, ai-agents]
takeaways:
  - "Claude Code 2.1.314, released October 30, adds permissions.blockWritesOutsideWorkingDirectories, which makes Write, Edit, and NotebookEdit refuse paths outside the working directories in every permission mode."
  - "In a lab run on 2.1.314, the block refused a Write and an Edit to an outside path even though an Edit allow rule covered that exact path."
  - "The block resolves symlinks: a Write to a link inside the project that points outside was refused with an error naming the real target."
  - "Bash is not covered: with an Edit allow rule for the outside path, a printf redirect wrote the file with the block on, both with and without the sandbox."
  - "To fence Bash as well, drop Edit allow rules for outside paths and keep the sandbox on, which returned Read-only file system for the same redirect."
---

An Edit allow rule used to settle whether Claude could write to a path outside the project. Since Claude Code 2.1.314, released October 30, one setting overrides it: `permissions.blockWritesOutsideWorkingDirectories`. Twelve `claude -p` runs show it refuses Write and Edit calls that an allow rule explicitly permits, follows symlinks to catch the real target, and does nothing at all to a Bash redirect.

<figure>
  <img src="/diagrams/claude-code-block-writes-outside-flow.svg" alt="Flow diagram. Write, Edit, and NotebookEdit resolve symlinks, then check if the target is inside a working directory. If not, and blockWritesOutsideWorkingDirectories is true, the call is refused before allow rules or the permission mode are asked. Bash redirects go through the redirect check and the sandbox instead, and neither reads the new setting." width="960" height="600" loading="lazy" />
  <figcaption>The new check sits in front of allow rules on the file-tool path only. Bash has its own path, and an Edit allow rule opens it.</figcaption>
</figure>

## What 2.1.314 adds

The [Claude Code changelog](https://code.claude.com/docs/en/changelog) entry for 2.1.314 reads: "Added `permissions.blockWritesOutsideWorkingDirectories`: Write, Edit and NotebookEdit refuse paths outside the working directories in every permission mode."

It is the write-side twin of a setting that already existed. The [settings reference](https://code.claude.com/docs/en/settings-reference#permissions-blockreadsoutsideworkingdirectories) describes `permissions.blockReadsOutsideWorkingDirectories` (since v2.1.257) as making the file tools "refuse reads outside your working directories in every permission mode, including `bypassPermissions`." As of October 30, 10:15 UTC, the settings reference documents only the read version; the write version is in the changelog alone.

The setting goes in any settings file:

```json
{
  "permissions": {
    "blockWritesOutsideWorkingDirectories": true
  }
}
```

"Working directories" means the directory Claude Code started in plus anything added with `--add-dir`, `/add-dir`, or `additionalDirectories`, per the [permissions docs](https://code.claude.com/docs/en/permissions#working-directories).

## The lab setup

The test project is `/tmp/lab/proj`, a fresh git repo. The target is `/tmp/lab/outside`. Each run is one `claude -p` call on 2.1.314 in `acceptEdits` mode, with settings passed through `--settings`:

```bash
cd /tmp/lab/proj
claude -p "Use the Write tool (not Bash) to create the file /tmp/lab/outside/c.txt \
  containing the single line: hello. Do not try any other way if it fails; \
  just report the exact error." \
  --model claude-haiku-5-5 --permission-mode acceptEdits \
  --settings /tmp/lab/allowblock.json \
  --output-format stream-json --verbose
```

Three settings files carry the variables:

```jsonc
// allow.json
{ "permissions": { "allow": ["Edit(//tmp/lab/outside/**)"] } }

// allowblock.json
{ "permissions": {
    "allow": ["Edit(//tmp/lab/outside/**)"],
    "blockWritesOutsideWorkingDirectories": true } }

// bashonly.json
{ "permissions": {
    "allow": ["Bash(printf *)"],
    "blockWritesOutsideWorkingDirectories": true } }
```

The `//` prefix in `Edit(//tmp/...)` is an absolute path in permission rule syntax. `acceptEdits` was used because it auto-approves edits only inside the working directory, so the outside path depends on the allow rule. A nested `bypassPermissions` launch was not tested here; the changelog's "every permission mode" claim is the source for that mode.

## Allow rule versus block

With no rule, the Write needs approval, which `-p` cannot give:

```text
Claude requested permissions to write to /tmp/lab/outside/a.txt, but you haven't granted it yet.
```

With `allow.json`, the same call succeeds:

```text
File created successfully at: /tmp/lab/outside/b.txt
```

With `allowblock.json`, same rule plus the block, the tool result is:

```text
/tmp/lab/outside/c.txt is outside /tmp/lab/proj; the permissions.blockWritesOutsideWorkingDirectories
setting blocks writes outside the working directories. Ask the user to add the directory with
/add-dir, or to remove that setting.
```

The block wins over the allow rule. An Edit of an existing outside file hits the same error. Adding `--add-dir /tmp/lab/outside` to the blocked run lets the Write through, because the target is now a working directory.

The setting also worked from the repository. With the block in `/tmp/lab/proj/.claude/settings.json` and the allow rule passed through `--settings`, the Write was refused with the same message. That matches how the read block behaves: the [settings reference](https://code.claude.com/docs/en/settings-reference#permissions-blockreadsoutsideworkingdirectories) says "A `true` in any file applies, so a repository can turn the block on for itself but can't lift yours."

## Symlinks do not get around it

A symlink inside the project, `proj/link -> /tmp/lab/outside`, makes the requested path look local. With the block on, a Write to `/tmp/lab/proj/link/h.txt` returns:

```text
/tmp/lab/proj/link/h.txt resolves through a symlink to /tmp/lab/outside/h.txt, which is outside
/tmp/lab/proj; the permissions.blockWritesOutsideWorkingDirectories setting blocks writes outside
the working directories.
```

Without the block, the same Write with the allow rule was not auto-approved either. The error read "resolves through a symlink to /tmp/lab/outside/h0.txt, which is outside the allowed working directories." The [permissions docs](https://code.claude.com/docs/en/permissions) describe this for `acceptEdits`: when the requested path is inside the working directories and the resolved file is not, "the write isn't auto-approved."

## Where Bash still writes

The changelog names three tools. Bash is not one of them, and the runs confirm it.

<figure>
  <img src="/diagrams/claude-code-block-writes-outside-runs.svg" alt="Results table of twelve runs. Write and Edit to the outside path were refused by the block even with an Edit allow rule, through a symlink, and with the block in the repo settings file; --add-dir allowed the write. Bash printf redirects with Bash and Edit allow rules wrote the file with the block on, with and without the sandbox. Without the Edit allow rule the redirect needed approval, and under the sandbox it failed with Read-only file system." width="960" height="704" loading="lazy" />
  <figcaption>Every green row on the file-tool side came from the block. Both red rows are Bash with an Edit allow rule for the outside path.</figcaption>
</figure>

The command was `printf "hello\n" > /tmp/lab/outside/e.txt`. With `Bash(printf *)` allowed and the block on, but no Edit rule for the outside path, Bash's own redirect check stopped it:

```text
Output redirection to '/tmp/lab/outside/e2.txt' needs approval. The path is outside the working
directories for this session ('/tmp/lab/proj'). Allowing runs the command as written.
```

Add the Edit allow rule back and the redirect runs: `(Bash completed with no output)`, and `e.txt` exists. That is documented behavior. For output redirects, the [permissions docs](https://code.claude.com/docs/en/permissions) say "the check covers your `Edit` allow and deny rules, protected paths, and the working directories." The block is not on that list.

The sandbox does not close it either, for the same reason. The [settings reference](https://code.claude.com/docs/en/settings-reference) says Claude Code "merges `allowWrite` entries and the paths from your `Edit(...)` allow permission rules" into the sandbox's writable paths. With `sandbox.enabled` and bubblewrap installed, the redirect still wrote `i2.txt`. Remove the Edit rule, keep the sandbox, and the kernel refuses:

```text
/bin/bash: line 1: /tmp/lab/outside/j.txt: Read-only file system
```

One sandbox caveat from the lab: without `bwrap` and `socat` on Linux, Claude Code prints "Sandbox disabled: sandbox is enabled but dependencies are missing" and runs commands unsandboxed. A settings file that says `"enabled": true` is not proof the sandbox is running.

## What one allow rule opens

<figure>
  <img src="/diagrams/claude-code-block-writes-outside-reach.svg" alt="Side by side. With the block off, the allow rule Edit(//tmp/lab/outside/**) lets the Write and Edit tools, Bash redirects, and sandboxed Bash write there. With the block on, the file tools are refused, while Bash redirects and sandboxed Bash still write." width="960" height="430" loading="lazy" />
  <figcaption>An Edit allow rule for an outside path is three permissions in one. The block revokes only the first.</figcaption>
</figure>

This matters for anyone who added the block to stop an agent from editing `~/.bashrc`, a sibling repo, or a shared config directory. If an older allow rule still names that path, Claude cannot use Write there but can reach the same file with a shell redirect or `tee`, whose targets the [permissions docs](https://code.claude.com/docs/en/permissions) also check against Edit allow rules. The fix is in the rules, not in the new setting.

In auto mode, Bash calls the block does not see still pass through the permission rules and the classifier; [how the auto mode classifier decides](/claude-code-auto-mode-classifier/) covers that order. The [2.1.309 sandbox fix for shell startup files](/week-claude-api-version-duet-sandbox/) is the other recent change on the Bash side.

## What to do

1. Upgrade and check: `claude --version` must report 2.1.314 or later.
2. Add `"blockWritesOutsideWorkingDirectories": true` under `permissions` in user or managed settings. A repository can turn it on for itself too.
3. List directories Claude should write outside the project with `--add-dir` or `additionalDirectories`, not with Edit allow rules.
4. Search every settings file for `Edit(//` and `Edit(~/` allow rules that point outside the repo, and delete the ones you added for convenience. Each one also opens Bash redirects and the sandbox to that path.
5. Turn on the sandbox and confirm it is running: on Linux, `which bwrap socat` must find both, and stderr must not show "Sandbox disabled".
6. Test it the way the lab did: one `claude -p` Write to an outside path, one `printf` redirect to the same path, and read both tool results.
