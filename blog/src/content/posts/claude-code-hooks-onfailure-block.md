---
title: "Claude Code hooks fail open: use onFailure block"
description: "Claude Code 2.1.295 adds onFailure block so a broken or slow hook stops the tool call instead of allowing it. Upgrade, then add it to every policy hook."
date: 2026-10-09T10:11:20Z
tags: [claude, claude-code, ai-security, devsecops, aiops]
takeaways:
  - "By default, a Claude Code PreToolUse command hook that is missing, exits 1, or times out does not block the tool call."
  - "Claude Code 2.1.295, released October 8, 2026, adds onFailure: \"block\" for command and HTTP hooks so a hook that can't start, times out, or exits with an unexpected code blocks the action."
  - "In a test with Claude Code 2.1.295, onFailure: \"block\" stopped a Bash call when the hook script was missing, exited 1, or passed its timeout, and let it run when the hook exited 0."
  - "Claude Code 2.1.294 fixed prompt and agent hooks written as instructions, such as \"Block commands that...\", allowing what they should block."
  - "Any team that uses Claude Code hooks as a policy gate should upgrade to 2.1.295 or later and set onFailure: \"block\" on each command and HTTP policy hook."
---

[Claude Code 2.1.295](https://code.claude.com/docs/en/changelog), released October 8, 2026, adds `onFailure: "block"` for command and HTTP hooks. Without it, a policy hook that crashes, is missing, or times out lets the tool call through. If you use `PreToolUse` hooks to stop Claude from running risky commands, upgrade and set this field on every policy hook today.

## What changed in Claude Code 2.1.294 and 2.1.295

The [Claude Code changelog](https://code.claude.com/docs/en/changelog) lists the new field under 2.1.295 (October 8, 2026):

> Added `onFailure: "block"` for command and HTTP hooks: a hook that can't start, times out, or exits with an unexpected code blocks the action instead of letting it through

The same week shipped several other fixes where a hook or guard could be skipped. All quotes are from the changelog:

| Version and date | Fix |
| --- | --- |
| 2.1.288, Oct 2 | "Fixed PreToolUse and PermissionRequest hooks being skipped when matching them failed or the tool's input could not be serialized to JSON; the call is now blocked" |
| 2.1.290, Oct 5 | "Fixed some permission rules and safety checks not being applied to a tool call after a PreToolUse hook rewrote its input" |
| 2.1.292, Oct 6 | "Fixed tool calls made while the plugin hooks worker restarts being answered without the plugins' permission hooks" |
| 2.1.294, Oct 8 | "Fixed `prompt` and `agent` hooks written as instructions (such as \"Block commands that...\") allowing what they should block" |
| 2.1.295, Oct 8 | "Fixed a mod's hook being handed a deeply nested tool input cut short with no error, so a guard could pass content it never saw" |

If your guardrails depend on hooks, any version before 2.1.295 misses at least one of these.

## Why a broken hook lets the tool call run

The [hooks reference](https://code.claude.com/docs/en/hooks) is explicit that only exit code 2 blocks on its own:

> For most hook events, exit code 2 is the only exit code that blocks through the code alone. Without valid JSON on stdout, Claude Code treats exit code 1 as a non-blocking error and proceeds with the action, even though 1 is the conventional Unix failure code.

Timeouts work the same way. On `PreToolUse`, the reference says: "A timed-out `command`, `http`, or `mcp_tool` hook doesn't block the tool call." For HTTP hooks, a non-2xx status and a connection failure are both a "non-blocking error, execution continues".

So a policy hook fails open in these cases:

- The script path is wrong, or the file was deleted or not made executable.
- A dependency the script calls, such as `jq` or `python3`, is missing on that machine, and the script exits with a code other than 2.
- The script hangs on a network call and hits its `timeout` (600 seconds by default for `command` and `http` hooks).
- The policy service behind an HTTP hook is down or returns a 5xx.

In each case the tool still runs. For a hook meant as a security control, that is the wrong default.

## Test results: default versus onFailure block

On October 9, 2026, a `PreToolUse` command hook with matcher `Bash` was run against Claude Code 2.1.295 in headless mode (`claude -p`). Each run asked Claude to execute `touch marker.txt`, with `Bash(touch *)` allowed. A created `marker.txt` means the call ran.

![Test grid for Claude Code 2.1.295: without onFailure, the Bash call ran when the hook was missing, exited 1, or timed out; with onFailure block, it was blocked in all three cases; with a healthy hook it ran in both setups](/diagrams/claude-code-hooks-onfailure-results.svg)

| Hook result | No `onFailure` | `"onFailure": "block"` |
| --- | --- | --- |
| Script path does not exist | Tool ran | Tool blocked |
| Script exits 1 | Tool ran | Tool blocked |
| Script sleeps 20 s, `timeout` is 3 | Tool ran | Tool blocked |
| Script exits 0 | Tool ran | Tool ran |

With the field set, the tool result Claude received named the cause. For the missing script it was `PreToolUse:Bash hook error: [/nonexistent/policy-check.sh]: failed; blocking because onFailure is "block"`, and for the slow script it said `timed out` in place of `failed`. HTTP hooks were not tested here; the changelog entry covers them.

## How to set onFailure block on a PreToolUse hook

Add the field to the hook handler, next to `type` and `command`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/policy-check.sh",
            "timeout": 10,
            "onFailure": "block"
          }
        ]
      }
    ]
  }
}
```

A short `timeout` matters more once the hook fails closed. With the 600 second default, a hung policy script stalls each matched tool call for ten minutes before it blocks.

As of October 9, 2026, the [hooks reference](https://code.claude.com/docs/en/hooks) does not yet list `onFailure` in its field tables, and its timeout section still describes only the fail-open behavior. Treat the changelog and your own tests as the source until the reference catches up.

## What to check

1. Run `claude --version` on laptops, CI runners, and agent hosts. Anything below 2.1.295 does not have `onFailure`.
2. Find command and HTTP `PreToolUse` hooks that do not fail closed:

   ```bash
   jq -c '.hooks.PreToolUse[]?.hooks[]?
     | select((.type == "command" or .type == "http") and .onFailure != "block")
     | {type, command, url}' ~/.claude/settings.json .claude/settings.json
   ```

   Run the same filter over your managed settings file and any plugin `hooks.json` you ship.
3. Add `"onFailure": "block"` to each hook that enforces policy. Leave it off hooks that only log or format, so a logging outage does not stop work.
4. Prove it. Point a copy of the hook at a path that does not exist and confirm the tool call is refused with `blocking because onFailure is "block"`.
5. Reread any `prompt` or `agent` hook you wrote as an instruction, such as "Block commands that...". Versions before 2.1.294 could allow what those hooks should block.
6. Ship policy hooks from managed settings. The hooks reference says `allowManagedHooksOnly` in managed settings blocks user, project, local, and plugin hooks, and that `disableAllHooks` set outside managed settings can't disable managed hooks.

## Trade-offs of failing closed

A fail-closed hook turns a policy outage into a Claude Code outage for the tools it matches. An HTTP policy hook on matcher `Bash` that loses its backend stops every Bash call. Plan for that:

| Choice | Effect when the hook breaks |
| --- | --- |
| No `onFailure` (default) | Tool runs |
| `"onFailure": "block"` on a narrow matcher | Only matched tools stop |
| `"onFailure": "block"` on a broad matcher | Most work stops until the hook is fixed |

Keep matchers as narrow as the policy allows, set a short `timeout`, and alert on hook errors the same way you alert on any other control that stops reporting.

Hooks are one layer. For the plugin layer that also sits in front of tool calls, see [the Claude Code mods security guide](/claude-code-mods-security-guide/).
