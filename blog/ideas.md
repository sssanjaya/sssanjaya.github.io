# Blog topic queue

The daily blog routine (claude.ai/code/routines) writes one post a day about
what changed in the past week, rotating through four areas: DevOps, SRE,
AIOps, and cybersecurity. It finds topics itself by searching the news and
primary sources.

To steer it, add a bullet under **Queue**: a topic, a link (release notes,
advisory, postmortem), or both. The routine takes the top queued item first,
writes the post, and removes the bullet in the same commit. With an empty
queue it picks the most useful news of the week in that day's area.

## Focus

These rules override the routine's default area rotation and style.

- Topics: Claude and Claude Code in operations, AIOps for SRE (AI agents in
  incident response, observability, and on-call), AI security (agents, MCP,
  prompt injection, model supply chain), and DevSecOps. Prefer a Claude or
  Anthropic angle when one exists in the past 7 days.
- Every post has at least one diagram or chart. Draw it as an SVG file in
  `blog/public/diagrams/<slug>-<name>.svg` on the dark panel palette
  (background `#0d1218`, text `#e6ebf2`) with a `<title>` and `<desc>`, and
  embed it with `![alt text](/diagrams/<file>.svg)`. Only draw real data or
  real structure (flows, order of checks, option ladders). Never invent numbers.
- Keep it simple and easy to read: short sections, short sentences, tables
  over long paragraphs, one idea per section.

This file is public in the repo. Customer names, internal hostnames,
credentials, and anything under NDA do not belong here.

## Queue

