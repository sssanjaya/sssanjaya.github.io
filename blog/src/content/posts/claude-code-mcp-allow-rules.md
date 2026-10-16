---
title: "Claude Code 2.1.299: MCP allow rules now match one server"
description: "Claude Code 2.1.299 stops mcp__a allow rules from covering servers like a__b and fixes deny rules for __ names. Upgrade, then audit your MCP rules."
date: 2026-10-16T10:09:32Z
tags: [claude, claude-code, mcp, ai-security, devsecops]
takeaways:
  - "From Claude Code 2.1.299, an MCP allow rule such as mcp__a no longer allows a server named a__b or a_."
  - "Before 2.1.299, deny and ask rules for an MCP server did not apply when the server's normalized name contained a double underscore."
  - "To allow every tool of a server whose name contains __, write mcp__ followed by the server's whole normalized name and __*."
  - "Subagent tools: lists in 2.1.299 take only the named MCP server's tools, so an agent that relied on the wider match loses those tools."
  - "Claude Code's tool_decision OpenTelemetry event shows whether an MCP call was approved by config, a hook, or a user, and names the server only when OTEL_LOG_TOOL_DETAILS=1."
---

Claude Code 2.1.299, released October 14, 2026, narrows how MCP (Model Context Protocol) permission rules match server names. An allow rule like `mcp__a` used to also approve tools from servers named `a__b` or `a_`, and deny or ask rules did not apply to servers with `__` in their names. Upgrade every Claude Code install to 2.1.299 or later, then rewrite any allow rule that depended on the old, wider match.

## What changed in Claude Code 2.1.299

The [Claude Code changelog](https://code.claude.com/docs/en/changelog) lists these permission changes under 2.1.299, dated October 14, 2026:

| Area | Changelog entry (verbatim) |
| --- | --- |
| Allow rules | "Changed MCP allow rules to reach only the server they name: `mcp__a` no longer allows a server named `a__b` or `a_`; write `mcp__<server>__*` with the server's whole normalized name" |
| Subagents | "Changed agent `tools:` lists to take only the named MCP server's tools; list a server whose name contains `__` as `mcp__<whole name>__*`" |
| Deny and ask rules | "Fixed deny and ask rules for an MCP server (`mcp__<server>`) not applying when the server's normalized name contains a double underscore" |

The two halves fail in opposite directions. The allow side approved more than the rule named. The deny side blocked less than the rule named. Both are fixed in the same release.

![Table of which MCP servers a Claude Code rule reaches. Allow rule mcp__a reached servers a, a__b, and a_ before 2.1.299 and only a from 2.1.299. A deny or ask rule mcp__a__b did not apply before 2.1.299 and applies from 2.1.299.](/diagrams/claude-code-mcp-allow-rules-matching.svg)

## How MCP permission rules are meant to work

The [permissions documentation](https://code.claude.com/docs/en/permissions) defines three forms for MCP rules:

- `mcp__puppeteer` matches any tool from the `puppeteer` server.
- `mcp__puppeteer__*` also matches all tools from that server.
- `mcp__puppeteer__puppeteer_navigate` matches one tool.

The same page says rules are evaluated "in order: deny, then ask, then allow," and that a deny at any settings level cannot be overridden by an allow at another. That model only holds if each rule matches the server it names. Before 2.1.299 it did not, for server names that extend another server's name with `__` or a trailing `_`.

Server names with `__` are legal. The [MCP documentation](https://code.claude.com/docs/en/mcp) says names added through `claude mcp` "can contain only letters, numbers, hyphens, and underscores," so `grafana__write` or `github_` are valid names.

## Why this matters for teams running Claude Code

- **An allow rule is a grant of tool access.** With `mcp__grafana` in user settings, a second server named `grafana__admin` was approved without a prompt on versions before 2.1.299. The person who wrote the rule never named that server.
- **Deny rules were the safety net, and they had a hole.** A managed or project deny rule such as `mcp__grafana__admin` for a server named `grafana__admin` did not apply before 2.1.299. Policies that tried to block one server by name could miss it.
- **Mixed versions across a fleet behave differently.** The same settings file grants different access on 2.1.296 and 2.1.299. Until every install is upgraded, assume the older behavior on machines you have not checked.

## What breaks after the upgrade

Interactive sessions will see permission prompts where they saw none before. The cases:

| You had | On 2.1.299 and later | Fix |
| --- | --- | --- |
| `mcp__a` in `allow`, and a server `a__b` | Calls to `a__b` tools are no longer pre-approved | Add `mcp__a__b__*` to `allow` |
| `mcp__a` in `allow`, and a server `a_` | Calls to `a_` tools are no longer pre-approved | Add `mcp__a___*` (the whole name `a_`, then `__*`) or rename the server |
| `tools: mcp__a` in a subagent file, expecting `a__b` tools | The subagent no longer gets `a__b` tools | List `mcp__a__b__*` in `tools:` |
| A deny or ask rule naming a server with `__` | The rule now applies | Nothing, unless a workflow depended on the rule being ignored |

Headless and CI (continuous integration) jobs that run Claude Code with pre-approved MCP tools are the place to look first. A call that used to pass on the wider match now needs its own rule.

## What to check

### 1. Confirm the version

`claude -v` prints the installed version. `claude update` moves to the latest release, per the [CLI reference](https://code.claude.com/docs/en/cli-reference). Anything below 2.1.299 still has the wide allow match and the deny gap.

### 2. Find server-level MCP rules in settings

This prints every `allow`, `ask`, or `deny` rule that names a server without a tool segment. Those are the rules whose reach changed:

```bash
for f in ~/.claude/settings.json .claude/settings.json .claude/settings.local.json; do
  [ -f "$f" ] && jq -r --arg f "$f" '
    .permissions // {} | to_entries[]
    | select(.key == "allow" or .key == "ask" or .key == "deny")
    | .key as $k | .value[]
    | select(test("^mcp__") and (ltrimstr("mcp__") | test("__") | not))
    | "\($f)\t\($k)\t\(.)"' "$f"
done
```

Run the same filter on your managed settings file if your organization deploys one.

### 3. Find server names that the old match could reach

Server names that contain `__` or end in `_` are the ones affected. Check the project `.mcp.json` and the user and local scopes in `~/.claude.json`:

```bash
jq -r '.mcpServers // {} | keys[] | select(test("__|_$"))' .mcp.json
jq -r '[(.mcpServers // {}), (.projects // {} | .[] | .mcpServers // {})]
  | map(keys[]) | .[] | select(test("__|_$"))' ~/.claude.json
```

If a name from step 3 starts with a server name from step 2, that server was riding on the shorter rule before 2.1.299. Decide whether it should be allowed. If yes, add its own `mcp__<whole name>__*` rule. If no, leave it to prompt or add a deny rule.

### 4. Check subagent tool lists

```bash
grep -rnE '^(tools|disallowedTools):.*mcp__' .claude/agents ~/.claude/agents 2>/dev/null
```

The [subagents documentation](https://code.claude.com/docs/en/sub-agents) says `mcp__<server>` or `mcp__<server>__*` "grants or removes every tool from the named server." On 2.1.299 that means the named server only.

### 5. Avoid `__` in new server names

A server name without `__` or a trailing `_` cannot collide with another server's rule. This is the simplest way to keep rules readable as more MCP servers get added.

## Audit MCP approvals with OpenTelemetry

Claude Code emits a `claude_code.tool_decision` event for each permission decision, per the [monitoring documentation](https://code.claude.com/docs/en/monitoring-usage). Its `source` attribute says where the decision came from: `config`, `hook`, `user_permanent`, `user_temporary`, `user_abort`, or `user_reject`.

For MCP tools there is one catch. The documentation says: "For user-configured MCP servers, the event's `tool_name` is always the literal `"mcp_tool"`, and the server and tool names appear only in `tool_parameters` with the flag on." To see which server a decision was for, set:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_LOGS_EXPORTER=otlp
export OTEL_LOG_TOOL_DETAILS=1
```

Then filter `tool_decision` events where `tool_name` is `mcp_tool` and `source` is `config`. Those are MCP calls approved by a rule with no prompt. Group them by `mcp_server_name` inside `tool_parameters` and compare the list against the servers your rules name. `OTEL_LOG_TOOL_DETAILS=1` also logs tool input, so filter or redact those attributes in your backend.

Claude Code 2.1.301, dated October 15, 2026 in the [changelog](https://code.claude.com/docs/en/changelog), adds two more fields to this event: "Added `classifier_verdict` and `permission_mode` to OpenTelemetry `tool_decision` events, so auto mode classifier decisions can be told apart from permission rules." As of October 16, 2026, the monitoring page did not yet list these attributes, so check the field names in your own event stream before you build alerts on them.

## Other MCP hardening in the same release

2.1.299 also changed how Claude Code handles MCP connections. From the [changelog](https://code.claude.com/docs/en/changelog):

| Change | What it means |
| --- | --- |
| Requests to claude.ai's connector proxy and Anthropic-hosted MCP servers "no longer follow HTTP redirects" | A redirect from those endpoints no longer sends the request somewhere else. The changelog says redirects by a connector's own server are unaffected. |
| "a blocked server is now reported as failed without being contacted" for servers added to a running headless or SDK session | Policy checks run before Claude Code connects. |
| `claude mcp list`, `claude mcp get`, and subagent MCP servers no longer start a server a policy check blocks | Listing servers no longer launches a blocked one. |

These matter if you rely on managed MCP policy. Before 2.1.299, some code paths could start or contact a server before policy said no.

For the wider picture of locking down Claude Code with managed policy, see the [Claude Code mods security guide](/claude-code-mods-security-guide/). Hooks that guard MCP calls have their own failure mode, covered in [Claude Code hooks fail open](/claude-code-hooks-onfailure-block/). For an MCP client-side bug in the same area, see the [MCP TypeScript SDK OAuth secrets leak](/mcp-typescript-sdk-oauth-credential-leak/).
