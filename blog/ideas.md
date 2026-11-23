# Blog topic queue

The blog routine (claude.ai/code/routines) publishes three posts a week, on
Monday, Wednesday, and Friday. Each post gives the reader one way to get more
done with AI: Claude Code, automation, and everyday productivity.

To steer it, add a bullet under **Queue**: a topic, a link (release notes,
advisory, postmortem, talk), or both. The routine takes the top queued item
first, writes the post, and removes the bullet in the same commit. With an
empty queue it picks the topic itself, following the Focus below.

## Focus

These rules override the routine's defaults, including its weekday formats,
its topic list, and its rule that the news item must be from the past 7 days.

- What this blog is about: getting more done with AI. Three areas only:
  - Claude Code: skills, slash commands, hooks, subagents, routines, MCP
    servers, CLAUDE.md, permissions, and workflows built from them.
  - AI and automation: handing a recurring chore to an agent end to end
    (triage, reviews, reports, releases, inbox and ticket cleanup, scripts).
  - Productivity with AI: prompts and habits that save real time in a
    working day, for engineers and for the people around them.
- Not this blog: monitoring and infrastructure tool tutorials, CVE and outage
  news, weekly roundups. Tools not in use, never write about them: Prometheus,
  Datadog. When unsure whether a tool is in use, pick a different topic.
- Default format, every scheduled day: a **prompt of the day** post. One
  reusable prompt that solves one specific, annoying, recurring problem.
  The post has these parts, in this order:
  1. A short name for the prompt as the title (2 to 4 words), followed by
     what it does, for example "Show Them Once: ...".
  2. Three sentences: what the prompt fixes, how it works, and what the
     reader walks away with. Then the hero visual.
  3. "Example inputs": three realistic situations a reader could paste in,
     each 2 to 4 sentences with concrete details (numbers, time available,
     what was already tried). Invented people and companies only.
  4. "The prompt": the full prompt in one fenced `text` block, ready to copy.
     Structure it with these tagged sections: `<role>`, `<context>`,
     `<constraints>`, `<goals>`, `<instructions>` (8 to 13 numbered steps),
     `<output_format>` (named sections of the answer), `<invocation>`.
     The prompt asks one question at a time, never invents data, and ends
     its output with a single "Do this now" action.
  5. "Use it in Claude Code": how to save the prompt as a skill or slash
     command, with the exact file path and file contents, checked against
     the current Claude Code docs. Also one line on pasting it into any chat.
  6. "A real run": give the prompt and one of the example inputs to a fresh
     subagent, and show a trimmed excerpt of what it really produced. Never
     write the output by hand. If it cannot be run, leave this part out.
  7. "What to do": numbered steps to put it to use the same day.
- Every prompt is original. Other prompt collections are a reference for the
  shape only; never copy or paraphrase their prompts.
- Pick problems from real working life with AI: reviewing a diff you did not
  write, turning a messy incident chat into a timeline, writing a handover,
  cutting a meeting into decisions and owners, cleaning a backlog, explaining
  a codebase to a new joiner, turning a repeated manual task into a routine.
- About one post in four may instead be a short how-to on a Claude Code or
  automation feature, with every command and config run in the sandbox and
  real output shown.
- Never repeat a prompt or technique an existing post already covers.
- Visuals: a hero diagram of the path the prompt walks the reader through
  (its steps and what comes out), plus one more that shows the result, such
  as before/after or the shape of the output. 2 visuals minimum. Only real
  structure and real data, never invented numbers.
- Sources: link the official docs for every claim about how Claude Code or
  another tool behaves. Skip marketing and funding news.

This file is public in the repo. Customer names, internal hostnames,
credentials, and anything under NDA do not belong here.

## Queue
