# Blog topic queue

The blog routine (claude.ai/code/routines) publishes three posts a week, on
Monday, Wednesday, and Friday. Each post explains one thing from the past week
in DevOps, SRE, AIOps, or security through pictures first and words second.

To steer it, add a bullet under **Queue**: a topic, a link (release notes,
advisory, postmortem, talk), or both. The routine takes the top queued item
first, writes the post, and removes the bullet in the same commit. With an
empty queue it picks the most interesting news of the week.

## Focus

These rules override the routine's defaults.

- Topics: Claude and Claude Code in operations, AIOps for SRE (AI agents in
  incident response, observability, and on-call), AI security (agents, MCP,
  prompt injection, model supply chain), cloud platform engineering, and
  DevSecOps. Prefer stories with a mechanism worth drawing: an attack chain,
  an outage cascade, a design change, a benchmark.
- Formats rotate by weekday: Monday is a weekly roundup, Wednesday a visual
  deep-dive or data/chart story, Friday a hands-on lab.
- Visuals carry the post. Every post has a hero visual right after the opening
  paragraph and 2 to 4 visuals in total (a roundup has one per item). A reader
  who only looks at the pictures and their captions should get the story.
- Visuals are only real data or real structure. Never invent numbers. Every
  chart cites its data source in the caption.

This file is public in the repo. Customer names, internal hostnames,
credentials, and anything under NDA do not belong here.

## Queue

