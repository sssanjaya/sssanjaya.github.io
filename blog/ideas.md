# Blog ideas

Raw notes for the daily blog routine (claude.ai/code/routines). It writes one
post a day from the **Ready** list, top first, and removes the bullet in the
same commit. It never writes from **Needs your facts** until you add a
`Facts:` line to that bullet, because it will not invent incidents, numbers,
or anecdotes. With nothing usable it skips the day.

To promote an idea: add a `Facts:` line with the real details (what broke,
numbers you may share, what you changed, what you'd do differently) and move
it to Ready. Two or three lines is enough.

This file is public in the repo. Customer names, internal hostnames,
credentials, and anything under NDA do not belong here.

## Ready


## Needs your facts

- HSTS preload follow-up, once hstspreload.org lists the domain: what changed
  between "pending" and "preloaded", how long it took, and what it means for
  adding a subdomain. Needs: the date it was listed
- An SRE's AI morning brief: routines that read the inbox, alerts, Jira, and
  calendar before you do, cluster flapping alerts, and draft replies without
  sending. Needs: what it caught that you'd have missed, what it got wrong,
  the guardrails (draft-only, no send)
- Alert storms as data: pairing triggered/recovered alerts, suppressing
  flaps shorter than a window, and flagging clusters on one customer
  account. Needs: window length, before/after alert volume
- SLOs for devices nobody logs into: defining "up" for an edge camera or
  gateway. Needs: the SLI you chose, the target, what it exposed
- Rolling a deployment to an edge fleet without bricking it: canary size,
  order, rollback trigger with AWS IoT Greengrass v2. Needs: your real
  rollout steps and one rollout that went wrong
- Debugging a device you can't touch: SSH tunnels vs SSM vs AWS IoT Secure
  Tunneling. Needs: when you use each and one real session that needed it
- RK3588 NPU inference in production: RKNN pitfalls, OOM kills, NPU access
  from containers. Needs: the failure modes you hit and the fixes
- Disk-full on edge devices: Docker images, logs, and the guardrail that
  worked. Needs: cause, fix, how you roll it out
- How MTTR dropped 30% with ELK, Prometheus, and Grafana (the number is on
  the portfolio). Needs: what changed (alerts, dashboards, runbooks)
- Terraform migration: environment setup from 3+ days to under 2 hours (on
  the portfolio). Needs: module layout, state strategy, what was manual
- A clean critical security audit: what you prepared. Needs: the generic
  controls, nothing under NDA
- A cost anomaly caught early on AWS. Needs: service, size, cause, guardrail
- The first 10 commands I run when I inherit a system. Needs: your list and
  why each one
- CKA prep notes: what tripped me up. Needs: the topics, as you go
- Designing Data-Intensive Applications, read by an SRE. Needs: the chapters
  that changed how you work, and how
- Vim on a remote box: the 20 commands that matter. Needs: your list
