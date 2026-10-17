---
title: "Claude Code OpenTelemetry: audit auto mode tool decisions"
description: "Claude Code 2.1.301 tags tool_decision events with the auto mode classifier verdict. Upgrade to 2.1.302, enable tool details, and check attribute limits."
date: 2026-10-17T10:06:38Z
tags: [claude, claude-code, aiops, observability, ai-security]
takeaways:
  - "Claude Code 2.1.301, published October 15, 2026, adds classifier_verdict and permission_mode to OpenTelemetry tool_decision events so auto mode classifier decisions can be told apart from permission rules."
  - "The classifier_category attribute names the built-in rule a classifier block matched, and it is only sent when OTEL_LOG_TOOL_DETAILS=1."
  - "Claude Code 2.1.302 fixed classifier_category missing on most classifier blocks, so 2.1.302 is the version floor for auditing auto mode."
  - "A low OTEL_LOGRECORD_ATTRIBUTE_COUNT_LIMIT could push tool_use_id, tool_source, and tool_parameters off tool_decision events before 2.1.302."
  - "As of October 17, 2026, the Claude Code monitoring docs do not yet list the new tool_decision attributes, so check real events before writing exact-match alert rules."
---

Claude Code 2.1.301 adds the auto mode classifier's verdict, the permission mode, and the matched block rule to its OpenTelemetry (OTel) `tool_decision` events. Before this, a tool call the classifier blocked looked much like one a permission rule blocked. If you collect Claude Code telemetry for audit or detection, upgrade fleets to 2.1.302, which fixes two bugs in the new fields, and update your queries.

![Flow of a Claude Code tool call through permission rules and the auto mode classifier, ending in one tool_decision event that from 2.1.301 carries classifier_verdict, permission_mode, and classifier_category](/diagrams/claude-code-otel-tool-decision-flow.svg)

## Why the auto mode classifier needs its own audit field

The [permission modes docs](https://code.claude.com/docs/en/permission-modes) say that with Claude Code v2.1.283 or later, "auto mode is the built-in starting permission mode for interactive terminal and VS Code sessions." In auto mode, "a second model, the classifier, reviews actions instead of you."

So in many interactive sessions, the classifier, not a person or a rule, decides tool calls that would otherwise prompt. Until 2.1.301 the audit record did not say so. The [monitoring docs](https://code.claude.com/docs/en/monitoring-usage) define the `source` attribute value `"config"` as covering project settings, personal allow or deny rules, managed policy, CLI flags, "the active permission mode", session grants, and inherently safe tools. The docs add: "The event doesn't indicate which of these sources matched."

## What changed in Claude Code 2.1.300 to 2.1.302

All quotes are from the [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). Publish dates are from the [npm registry](https://registry.npmjs.org/@anthropic-ai/claude-code).

| Version, npm publish date | Telemetry change |
| --- | --- |
| 2.1.300, Oct 14 | "Added `cache_creation_5m_tokens` and `cache_creation_1h_tokens` to the OpenTelemetry `api_request` event, splitting cache writes by lifetime" |
| 2.1.300, Oct 14 | "Added OpenTelemetry GenAI semantic-convention attributes to trace spans, such as `gen_ai.provider.name`, `gen_ai.conversation.id`, `gen_ai.tool.name` and `error.type`" |
| 2.1.301, Oct 15 | "Added `classifier_verdict` and `permission_mode` to OpenTelemetry `tool_decision` events, so auto mode classifier decisions can be told apart from permission rules" |
| 2.1.301, Oct 15 | "Added `classifier_category` to OpenTelemetry `tool_decision` events, naming the built-in rule a classifier block matched, when `OTEL_LOG_TOOL_DETAILS=1`" |
| 2.1.302, Oct 16 | "Fixed `classifier_category` missing from OpenTelemetry `tool_decision` events for most auto mode classifier blocks, and new `tool_decision` attributes pushing out `tool_use_id`, `tool_source` and `tool_parameters` when `OTEL_LOGRECORD_ATTRIBUTE_COUNT_LIMIT` is low" |

The 2.1.302 fix matters for anyone who ran 2.1.301. On that version, most classifier blocks arrived without a category, and a tight attribute limit could drop the fields you join on.

## What classifier_category tells you

The [auto mode configuration docs](https://code.claude.com/docs/en/auto-mode-config) explain that a block shows a bracketed reason such as `[Data Exfiltration]` or `[Production Deploy]`, and that "The text in square brackets, such as `[Data Exfiltration]`, is the name of the rule the classifier matched." Per the changelog, `classifier_category` carries the name of the built-in rule a block matched.

That gives detection teams a field to group on. The auto mode docs say repeated denials for the same destination usually mean the classifier is missing context, so a rising count of one category across many users can point to a missing `autoMode.environment` entry. A single user with many blocks in an exfiltration category is worth a closer look.

Two limits apply:

- `classifier_category` is gated on `OTEL_LOG_TOOL_DETAILS=1`. That flag also logs Bash commands, MCP (Model Context Protocol) server and tool names, and tool input. Treat the log store as sensitive.
- As of October 17, 2026, the `tool_decision` section of the monitoring docs does not list `classifier_verdict`, `permission_mode`, or `classifier_category`, and no source lists their possible values. Look at real events from your own fleet before writing filters that match exact strings.

## Why OTEL_LOGRECORD_ATTRIBUTE_COUNT_LIMIT matters here

`OTEL_LOGRECORD_ATTRIBUTE_COUNT_LIMIT` is a standard OTel SDK setting. The [OTel SDK environment variable spec](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/) gives it a default of 128. The [OTel common spec](https://opentelemetry.io/docs/specs/otel/common/) says that if adding an attribute would exceed the limit, "the SDK MUST discard that attribute".

Each Claude Code release adds attributes to events. If someone set a low limit to save storage, the newest fields can push out older ones. The 2.1.302 fix covers the case where `tool_use_id`, `tool_source`, and `tool_parameters` were lost. The docs say `tool_use_id` "Matches the `tool_use_id` passed to hooks", so losing it breaks the join between telemetry and hook logs.

## How to send tool_decision events with the new fields

The monitoring docs show OTel settings delivered through the `env` block of managed settings. Add `OTEL_LOG_TOOL_DETAILS` to that block:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://collector.example.com:4317",
    "OTEL_LOG_TOOL_DETAILS": "1"
  }
}
```

Managed settings are the right place for this. Per the monitoring docs, Claude Code ignores the OTel exporter variables in a repository's `.claude/settings.json` and `.claude/settings.local.json`. The docs also say: "When you set an `OTEL_EXPORTER_OTLP_*` variable in managed settings, Claude Code removes conflicting developer-set variables at startup and logs a warning in the debug log." Keep collector tokens out of cloud environment variables, since the docs note that anyone who uses an environment can read its variables.

## What to check

1. Run `claude --version` on laptops, CI runners, and agent hosts. Versions below 2.1.301 do not send the new fields. Treat 2.1.302 as the floor.
2. Search your managed settings, launch wrappers, and shell profiles for `OTEL_LOGRECORD_ATTRIBUTE_COUNT_LIMIT` and `OTEL_ATTRIBUTE_COUNT_LIMIT`. Remove low values or raise them, then confirm `tool_use_id` is present on `tool_decision` events.
3. Decide whether `OTEL_LOG_TOOL_DETAILS=1` is acceptable for your log store. Without it you get `classifier_verdict` and `permission_mode`, but no `classifier_category` and no command text.
4. Pull a sample of `claude_code.tool_decision` events with `decision` set to `"reject"` and record the real values of the three new attributes before you build dashboards.
5. Pair the events with `claude_code.permission_mode_changed`. The docs say its `trigger` can be `"shift_tab"`, `"exit_plan_mode"`, `"auto_gate_denied"`, or `"auto_opt_in"`.
6. For the exact input of a classifier denial, the auto mode docs point to a `PermissionDenied` hook, which "receives it as `tool_input`".
7. If you track cost, update token panels for the 2.1.300 split of cache writes into `cache_creation_5m_tokens` and `cache_creation_1h_tokens`.

## Where this fits with hooks and permission rules

The classifier is not a hard boundary. The auto mode docs say "For actions that must never run regardless of user intent or classifier configuration, use `permissions.deny` in managed settings." Telemetry tells you what the classifier did. Deny rules and fail-closed hooks decide what can never run. For those layers, see [failing Claude Code hooks closed with onFailure block](/claude-code-hooks-onfailure-block/) and [scoping Claude Code MCP allow rules to one server](/claude-code-mcp-allow-rules/).
