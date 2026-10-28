---
title: "Claude Code ultrathink Now Sets xhigh Effort: What Gates It"
description: "Claude Code 2.1.311 makes ultrathink run its turn at xhigh effort, but only in the terminal, on newer models, and below any cap. How to check each turn."
date: 2026-10-28T10:10:04Z
tags: [claude-code, productivity, ai-agents]
takeaways:
  - "Since Claude Code 2.1.311, typing ultrathink in the interactive terminal runs that turn at xhigh effort on Opus 5.5, Sonnet 5.5, Haiku 5.5, and Fable 5.1 through Anthropic's API."
  - "The raise lasts one turn: a PreToolUse hook on 2.1.312 logged medium, xhigh, medium for a plain prompt, an ultrathink prompt, and the next plain prompt."
  - "The word only adds an in-context instruction when it is quoted, part of a path or command, in a claude -p run, on Amazon Bedrock, or when CLAUDE_CODE_EFFORT_LEVEL or a cap holds effort below xhigh."
  - "The rainbow coloring on the word now appears only where it can raise effort, so a plain-colored ultrathink means the turn stays at the session level."
  - "Hooks receive the level in effect as effort.level in their JSON input and as the CLAUDE_EFFORT environment variable, which makes the raise auditable."
---

On Opus 5.5, Claude Code runs at `medium` effort by default. Since version 2.1.311, released on October 26, one word in your prompt moves a single turn two levels up to `xhigh`: `ultrathink`. The catch is that the same word does nothing to effort in a `claude -p` run, inside quotes, on Amazon Bedrock, or when an environment variable pins the level, and the only on-screen signal is whether the word turns rainbow-colored.

<figure>
  <img src="/diagrams/claude-code-ultrathink-xhigh-effort-turns.svg" alt="One Opus 5.5 session with three prompts. Before 2.1.311 all three turns ran at medium and ultrathink only added an in-context instruction. From 2.1.311 the ultrathink turn runs at xhigh and the next turn is back at medium. A PreToolUse hook on 2.1.312 logged medium, xhigh, medium." width="900" height="480" loading="lazy" />
  <figcaption>The raise is scoped to one turn. The hook log at the bottom is real output from Claude Code 2.1.312.</figcaption>
</figure>

## What changed in 2.1.311

The [Claude Code changelog](https://code.claude.com/docs/en/changelog) entry for 2.1.311 reads: "Changed `ultrathink` in the interactive terminal to run its turn at xhigh effort on Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 through Anthropic's API; typed while Claude is working, it raises the rest of that turn." A second entry changes the rainbow highlight "to appear only where the keyword can raise effort, and not when the word is quoted or part of a file path."

Effort is the model parameter that sets how much reasoning Claude spends per step. The [model configuration docs](https://code.claude.com/docs/en/model-config) list five levels for the 5.5 models (`low`, `medium`, `high`, `xhigh`, `max`) and say "Opus 5.5, Sonnet 5.5, and Haiku 5.5 default to `medium`." The docs describe the base behavior of `ultrathink` as a way to "request deeper reasoning on that turn without changing your session effort setting": Claude Code "adds an in-context instruction." That still happens everywhere. What 2.1.311 adds, where the gates below allow it, is a higher effort value on the request itself.

The practical shift: a team that sets `medium` for cost reasons, then reaches for `ultrathink` on the hard bug, used to get a nudge. Now it gets `xhigh` for that turn only, without touching `/effort` and without changing the saved default.

## When the word raises effort, and when it does not

<figure>
  <img src="/diagrams/claude-code-ultrathink-xhigh-effort-gate.svg" alt="Decision flow. ultrathink raises the turn to xhigh only if it is typed in the interactive terminal prompt, is a bare word outside quotes, brackets, paths, commands, or a slash prompt, the model is a 5.5 model or Fable 5.1 on Anthropic's API, and nothing caps effort below xhigh. Any no leads to a plain word that only adds an in-context instruction." width="900" height="560" loading="lazy" />
  <figcaption>Four gates, all from the docs. Failing any one leaves the word as plain text plus an instruction; the missing rainbow is the only sign.</figcaption>
</figure>

The [docs](https://code.claude.com/docs/en/model-config) say: "Typed in the terminal prompt, the word can also raise that turn to `xhigh` effort. When it can, the word shows in rainbow colors." If the word is not rainbow-colored, the same page lists what to try:

- Retype it "outside anything such as quotes, brackets, a path, or a command, in a prompt that doesn't start with `/`"
- Unset `CLAUDE_CODE_EFFORT_LEVEL` "if it's set below `xhigh`," or raise `maxEffortLevel` or the organization limit
- Switch to an Opus 5.5, Sonnet 5.5, Haiku 5.5, or Fable 5.1 model. "Where the word can't raise a turn, such as on Amazon Bedrock, set the effort level instead"

Gate 4 follows from the [effort resolution order](https://code.claude.com/docs/en/model-config): an explicit choice through `CLAUDE_CODE_EFFORT_LEVEL`, `--effort`, or `/effort` comes first, then saved settings, then the model default. The [environment variable reference](https://code.claude.com/docs/en/env-vars) says of `CLAUDE_CODE_EFFORT_LEVEL`: "Takes precedence over `--effort`, `/effort`, and the `modelSettings` and `effortLevel` settings."

## Proving it with a hook

The rainbow is a terminal color. To see the level a request actually carried, use a hook. The [hooks reference](https://code.claude.com/docs/en/hooks) says hook input includes an `effort` object "with a `level` field holding the effort level in effect when the hook runs," present for tool events such as `PreToolUse`, and that the same value reaches hook commands "as the `$CLAUDE_EFFORT` environment variable."

This project setting logs the level for every Bash call:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command",
          "command": "jq -c '{tool: .tool_name, effort: .effort.level}' >> effort.log" } ] }
    ]
  }
}
```

Running an interactive Claude Code 2.1.312 session on Opus 5.5 with four prompts, one after another, shows the raise and the reset:

```console
$ claude --model claude-opus-5-5
❯ Run the Bash command: echo turn1
❯ ultrathink. Run the Bash command: echo turn2
❯ Run the Bash command: echo turn3
❯ Run the Bash command: echo "ultrathink"

$ cat effort.log
{"tool":"Bash","effort":"medium"}
{"tool":"Bash","effort":"xhigh"}
{"tool":"Bash","effort":"medium"}
{"tool":"Bash","effort":"medium"}
```

The fourth prompt has the word inside quotes, so it stays at `medium`, as gate 2 predicts. Two more runs check the other gates:

```console
$ claude -p "ultrathink. Run the Bash command: echo deep" --model claude-opus-5-5
$ tail -1 effort.log
{"tool":"Bash","effort":"medium"}

$ CLAUDE_CODE_EFFORT_LEVEL=high claude --model claude-opus-5-5
❯ ultrathink. Run the Bash command: echo pinned
$ cat effort.log
{"tool":"Bash","effort":"high"}
```

A `-p` run ignores the word for effort purposes, and a pinned `high` stays `high`. Any CI job, script, or SDK wrapper that relies on `ultrathink` for a deeper pass gets the instruction and nothing more. If those jobs need `xhigh`, they have to ask for it with `--effort xhigh` or the environment variable.

## What xhigh costs in time

`xhigh` sits between `high` and `max`. Anthropic's post [Using Claude Code: Spending your effort](https://claude.dev/blog/spending-your-effort/) (September 25) timed the same fitness-tracker build at four levels. It skipped `xhigh` in that example, but the spread shows how steep the curve is.

<figure>
  <img src="/diagrams/claude-code-ultrathink-xhigh-effort-minutes.svg" alt="Bar chart of minutes to build the same fitness app. Underspecified prompt: low 1.5, medium 4, high 11, max 67 minutes. Highly specified interview spec: low 16, medium 22, high 33, max 79 minutes." width="900" height="490" loading="lazy" />
  <figcaption>From medium to high, the underspecified build went from 4 to 11 minutes; xhigh was not timed in this example. Source: <a href="https://claude.dev/blog/spending-your-effort/">Using Claude Code: Spending your effort</a>.</figcaption>
</figure>

The same post has a case closer to an SRE's day. On `mvcc-lsm-compaction`, a Terminal-Bench 3.0 task that asks for a storage-engine crash fix, "Opus 5.5 went from 0/5 at low to 4/5 at xhigh." Attempts took "about a minute" at low and "about 11 minutes" at xhigh. At xhigh, "Claude reproduced the crash first, wrote a randomized test against a reference that never compacts, and checked that its tests failed on half-finished fixes." That is the kind of turn where a one-word raise pays for itself. A rename is not.

## Mid-turn raises and the 2.1.312 indicator fix

Per the 2.1.311 changelog, typing `ultrathink` while Claude is working "raises the rest of that turn." The [docs](https://code.claude.com/docs/en/model-config) describe the general rule for a mid-turn effort change: Claude gets a queued message "when its current tool calls finish, or when the turn ends at the latest, and works at the new level from then on."

Version 2.1.312, released October 27, fixed the readout around this. The [changelog](https://code.claude.com/docs/en/changelog) says the spinner, OpenTelemetry `effort` values, and transcripts had been "naming a newly picked effort level during a task before the model applied it; they now show the level in force." Anyone charting effort from OpenTelemetry (OTel) data before 2.1.312 may show a new level on mid-turn changes before the model applied it. The same release made the prompt's effort indicator say a mid-task change "may wait for your next message."

For a broader look at what changed in the sandbox and API the same week, see the [roundup on API version 2026-10-21 and Claude Code 2.1.309](/week-claude-api-version-duet-sandbox/). For how auto mode decides what runs without a prompt, see [what the auto mode classifier lets through](/claude-code-auto-mode-classifier/).

## What to do

1. Upgrade and confirm: `claude --version` should report 2.1.311 or later for the raise, and 2.1.312 or later for correct effort values in OpenTelemetry.
2. Watch the word as you type it. Rainbow means `xhigh` for that turn. Plain means instruction only.
3. Check your environment for `CLAUDE_CODE_EFFORT_LEVEL`. A value below `xhigh` silently disables the raise; `env | grep CLAUDE_CODE_EFFORT_LEVEL` shows it.
4. Replace `ultrathink` in scripts, `claude -p` jobs, and Bedrock setups with `--effort xhigh` where you want the deeper pass. The word does not raise effort there.
5. Add the `PreToolUse` hook above, or read `$CLAUDE_EFFORT` in an existing hook, if you need an audit trail of which turns ran at which level.
6. If cost matters, cap it once with the `maxEffortLevel` managed setting instead of asking people not to type a word. The docs say this cap works on any plan and any provider, Amazon Bedrock included.
