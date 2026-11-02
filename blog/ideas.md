# Blog topic queue

The blog routine (claude.ai/code/routines) publishes three posts a week, on
Monday, Wednesday, and Friday. Each post teaches people who run production how
to do one thing better, with pictures first and words second.

To steer it, add a bullet under **Queue**: a topic, a link (release notes,
advisory, postmortem, talk), or both. The routine takes the top queued item
first, writes the post, and removes the bullet in the same commit. With an
empty queue it picks the topic itself, following the Focus below.

## Focus

These rules override the routine's defaults, including its rule that the news
item must be from the past 7 days.

- Topic mix: practical "how to do it better" guides for engineers who run
  production. Rotate across these areas and do not pick the same area two
  posts in a row:
  - Terminal and shell productivity: shell, tmux, git, ssh, fzf, ripgrep,
    jq, dotfiles, scripting habits that save time every day.
  - SRE: alerting that pages less and catches more, SLOs and error budgets,
    incident response, postmortems, capacity, debugging slow or failing
    services.
  - DevOps: CI/CD speed and reliability, Kubernetes, Terraform and other
    infrastructure as code, containers, deploy strategies, cost.
  - DevSecOps: supply chain (pinning, SBOMs, signing), secrets handling,
    least-privilege CI, scanning that people do not ignore, hardening.
  - AIOps and AI tools for operators: using LLM agents and coding assistants
    safely in ops work, anomaly detection, log and alert triage. Claude Code
    and other AI tools are one topic among these, at most one post in four.
- Post shape: name the common way people do it, show where it breaks, then
  show the better way with exact commands or config, run in the sandbox with
  real before/after output. End with "What to do" steps a reader can apply
  the same day.
- Timeliness: a post does not need a news hook. When something from the past
  week fits (a release, a postmortem, a CVE, a new feature), use it as the
  hook and link it. Evergreen techniques are fine when every claim is sourced
  and every command is run.
- Never cover a technique an existing post already covers.
- Primary sources first: official docs, man pages, release notes, vendor
  advisories, CVE records, official postmortems, conference talks, and
  standards. Skip marketing and funding news.
- Formats rotate by weekday: Monday is a practical guide built on the week's
  most useful release or incident (a weekly roundup only when the week has
  five items worth acting on), Wednesday a visual deep-dive or data/chart
  story, Friday a hands-on lab.
- Prefer topics with a mechanism worth drawing: a pipeline, a request flow,
  a decision tree, a before/after workflow, a benchmark.
- Visuals carry the post. Every post has a hero visual right after the opening
  paragraph and 2 to 4 visuals in total (a roundup has one per item). A reader
  who only looks at the pictures and their captions should get the story.
- Visuals are only real data or real structure. Never invent numbers. Every
  chart cites its data source in the caption, or names the sandbox run that
  produced it.

This file is public in the repo. Customer names, internal hostnames,
credentials, and anything under NDA do not belong here.

## Queue
