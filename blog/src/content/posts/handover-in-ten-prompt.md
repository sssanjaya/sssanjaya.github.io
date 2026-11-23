---
title: "Handover in Ten: A Prompt for Notes Nobody Calls You About"
description: "A prompt that turns half-finished work into a one-page handover note in ten minutes. Full prompt, a real run, and how to save it as a Claude Code skill."
date: 2026-11-23T14:08:40Z
tags: [prompts, claude-code, productivity, handover]
takeaways:
  - "A handover note fails when it tells the history of the work; the next person needs the state right now, the next three actions, and a way to check each one."
  - "Handover in Ten asks up to eight questions, one at a time, starting with what is still broken, and skips anything already answered."
  - "The prompt writes Unknown wherever the writer could not answer, so gaps stay visible instead of being filled with guesses."
  - "Before finishing, the prompt rereads its own note as a stranger and lists the points where that reader would have to stop and ask."
  - "Saved as .claude/skills/handover/SKILL.md, the prompt runs in Claude Code as /handover followed by a description of the situation."
---

This prompt fixes the handover that says "mostly done, ping me if you have questions". It asks one question at a time, starting from what is still broken, and pushes every next step until it names an exact thing and a way to check it. You finish with a one-page note that someone else can pick up cold, without calling you on your day off.

<figure>
  <img src="/diagrams/handover-in-ten-prompt-flow.svg" alt="Flow diagram of the Handover in Ten prompt. Work in progress that lives in one person's head goes in. The prompt asks up to eight questions in four groups: the state right now, what only you know, the next three actions, and guardrails and people. It writes a one-page note, rereads it as a stranger, asks up to three more questions, and ends with one action to do before leaving." width="920" height="560" loading="lazy" />
  <figcaption>Up to eight questions go in, one page comes out, and the note is tested by a cold read before you leave.</figcaption>
</figure>

## Example inputs

Paste any of these, or your own version, as the first message.

> I am out from tomorrow for a week. The billing export job is half migrated: the new script runs but skips refunds, the old cron is still on, and only I know why the staging data looks wrong.

> My on-call week ends in 20 minutes. Two alerts fired overnight and I silenced one of them until Friday. A customer import is stuck at 60% and I have a theory about why, but I have not tested it. The next person on call is new to this service.

> I manage our office and I am moving to another team on Monday. The internet contract renews on the 1st and I was halfway through negotiating a lower price by email. Three people are waiting on laptop orders, and the supplier only replies to me.

## The prompt

```text
<role>
You write handover notes for work that is not finished. You assume the reader is capable, busy, and has none of the writer's context. You care about the state of things right now, not the story of how they got that way. A note passes one test only: a stranger can take the next action without calling the writer.
</role>

<context>
The user is about to step away from work in progress. It may be leave, a rotation change, a reassignment, or the end of a long day. Something is half migrated, half fixed, or half decided, and the facts that matter live in the user's head. They usually have about ten minutes. The person who picks the work up will read the note cold, possibly while something is going wrong, and cannot ask follow-up questions.
</context>

<constraints>
- Ask one question at a time and wait for the answer before moving on.
- Skip any question the user has already answered. Never ask for something twice.
- Never invent facts, names, commands, paths, or dates. Where something is unknown, write "Unknown" and say who or what would settle it.
- Put state before history. Include how things got this way only when the reader needs it to act.
- Keep the user's own names for systems, jobs, files, and people. Do not rename anything.
- Every action starts with a verb, names the exact thing it acts on, and comes with a check that shows it worked.
- Mark anything that cannot be undone, and say what it would cost.
- No secrets in the note. Say where a credential lives, never what it is.
- Ask at most eight questions. Hold the finished note to one page.
- No filler, no apologies, no summary of the conversation.
</constraints>

<goals>
- Capture what is true right now: what works, what is broken, and what is running that should not be.
- Get the facts that exist only in the user's head onto the page.
- Reduce the work to the next three actions, in order, each one checkable.
- Name the traps: things that look fine and are not, and things that look broken and are fine.
- Tell the reader who to ask and what each person can actually answer.
- Leave the unknowns visible instead of papering over them.
</goals>

<instructions>
1. Ask what is still broken or unfinished right now. If the user starts telling the history, bring them back to the present state.
2. Ask what is running, scheduled, or half switched over at this moment, including anything old that is still on beside the thing replacing it.
3. Ask what only the user knows: the odd fact, the workaround, the reason something looks wrong but is expected.
4. Ask what the next person should do first, then second, then third. Push each answer until it names an exact thing and a way to check it worked.
5. Ask what must not be touched, and why. Separate "will break something" from "cannot be undone".
6. Ask what could go wrong while the user is away, and what the first sign of it would be.
7. Ask who else knows part of this, and exactly which part.
8. Ask where the credentials, dashboards, documents, and tickets live. Take locations only.
9. Write the note in the output format. Use short lines. Put "Unknown" wherever the user could not answer.
10. Reread the note as a stranger who has never seen this work. List up to three points where that reader would have to stop and ask, and put each to the user as a question, one at a time. Fold the answers into the note.
11. Finish with the one action the user should take before they leave.
</instructions>

<output_format>
State Right Now
What works, what is broken, and what is running, each on its own line. No history.

Next Three Actions
Numbered, in order. Each line: the action, the exact thing it acts on, and the check that shows it worked.

What Only I Knew
The facts that were in the writer's head: workarounds, expected oddities, reasons behind decisions.

Traps
What looks fine and is not. What looks broken and is fine.

Do Not Touch
Each item with the reason, and a clear mark on anything that cannot be undone.

If It Goes Wrong
The first sign of trouble for each likely failure, and the first move to make.

Who To Ask
Name, and the specific part of this they can answer.

Where Things Live
Locations of credentials, dashboards, documents, and tickets. No secret values.

Unknowns
Everything still open, and who or what would settle it.

Do This Now
The single thing to do before stepping away.
</output_format>

<invocation>
Begin with one short, calm line saying what you are about to do and that it takes about ten minutes. Then start with step 1 of the instructions.
</invocation>
```

## Use it in Claude Code

Claude Code loads reusable prompts as [skills](https://code.claude.com/docs/en/skills). A project skill lives at `.claude/skills/<skill-name>/SKILL.md`, and a personal one, available in all your projects, at `~/.claude/skills/<skill-name>/SKILL.md`.

Create `~/.claude/skills/handover/SKILL.md` with this header, then paste the full prompt below it:

```markdown
---
name: handover
description: Write a one-page handover note for unfinished work by asking one question at a time.
disable-model-invocation: true
---

<role>
You write handover notes for work that is not finished. ...
```

Then run it with the situation as the argument:

```text
/handover I am out from tomorrow for a week. The billing export job is half migrated...
```

Two details from the docs matter here. `disable-model-invocation: true` is for "workflows you want to trigger manually with `/name`", so the skill only runs when you call it. And when a skill has no `$ARGUMENTS` placeholder, Claude Code appends what you typed after the command as `ARGUMENTS: <value>`, so the prompt still receives your situation.

Outside Claude Code, paste the prompt as the first message of any chat, then describe the situation.

## A real run

The prompt was given to a fresh agent together with the first example input. Its first turn:

```text
I'll turn this into a one-page handover note someone can act on without
calling you. It takes about ten minutes, one question at a time.

You've covered what's broken and what's still running, so straight to the
part only you know: why does the staging data look wrong, and is it
expected or a real problem?
```

It skipped the first two questions because the input had already answered them. The rest of the answers were then supplied in one message, as someone short on time would do. Part of the note it wrote, with Markdown formatting removed:

```text
State Right Now
- Works: export_legacy (cron on host batch-01, 02:00 UTC nightly).
  Finance relies on this file.
- Broken: export_v2.py (billing-jobs repo) runs but skips refunds. Refund
  rows have a negative amount and the filter drops amount <= 0.
- Running: export_legacy is still on and must stay on. Whether
  export_v2.py is scheduled anywhere: Unknown.
- Staging: every total is doubled. Production is not affected.

Next Three Actions
1. Fix the filter in export_v2.py so refund rows (negative amount) are
   kept. Check: run it against March in staging and compare with the
   legacy file. Refunds appear, and staging totals are double the legacy
   totals.
2. Run export_v2.py and export_legacy side by side for three nights.
   Check: diff the two output files each night and find no differences.
3. Turn off export_legacy on batch-01, only after step 2 passes. Check:
   no legacy run at 02:00 UTC, and finance still receives their file.

Traps
- Looks fine, is not: export_v2.py finishes without error but its output
  has no refunds.
- Looks broken, is fine: staging totals are twice what they should be.

Where a stranger would get stuck
1. What is the exact command to rerun export_legacy by hand on batch-01?
2. Where do export_legacy and export_v2.py each write their output file?
3. Is export_v2.py scheduled anywhere, or does someone have to run it by
   hand each night for the side-by-side?
```

The last block is the cold-read test at work. Nobody had said how to rerun the old job or where the files land, and the prompt caught both before the writer left. The names and systems in this run are invented for the example.

<figure>
  <img src="/diagrams/handover-in-ten-prompt-before-after.svg" alt="Before and after. Before: a one-line chat message saying the billing export is mostly done and to ping the writer with questions, with no current state, no next action, no way to check anything, and nobody else to ask. After: a one-page note with ten sections: State Right Now, Next Three Actions, What Only I Knew, Traps, Do Not Touch, If It Goes Wrong, Who To Ask, Where Things Live, Unknowns, Do This Now." width="920" height="600" loading="lazy" />
  <figcaption>The usual one-liner leaves the reader with nothing to act on. The note has ten sections, and each one answers a question the next person would otherwise call about.</figcaption>
</figure>

## Why it starts with what is broken

Left alone, most people write a handover as a diary: what they did, in the order they did it. The reader then has to work out the current state from the story.

The prompt reverses the order. Its first two questions are about the present: what is unfinished, and what is running that should not be. History only gets in when the reader needs it to act. Three more rules in the prompt do most of the remaining work:

- **Every action needs a check.** "Fix the filter" becomes "fix the filter, then run it against March and compare with the legacy file".
- **Unknown is an allowed answer.** In the run above, the prompt wrote Unknown for whether the new script was scheduled, and did not guess.
- **The note is tested before it ships.** The cold read finds the gaps while the writer is still around to fill them.

## What to do

1. Save the prompt as `~/.claude/skills/handover/SKILL.md` with the header above, or keep it in a note you can paste from.
2. Pick the one task you would hate to explain on a call next week, and run the prompt on that first.
3. Answer the cold-read questions before you close the chat. They are the calls you would otherwise get.
4. Paste the finished note where the next person will look first, such as the ticket, and tell the people it names.
5. On your next handover, give the prompt to the person handing work to you.
