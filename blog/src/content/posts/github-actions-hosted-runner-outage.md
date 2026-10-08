---
title: "GitHub Actions outage Oct 5: 47% of hosted runs failed"
description: "A network failure on Oct 5 stalled GitHub-hosted runners for hours. See what broke, then add queue-time alerts and a runner switch before the next one."
date: 2026-10-08T10:08:09Z
tags: [github-actions, github, incident-management, ci-cd, sre]
takeaways:
  - "On October 5, 2026, between 18:48 and 22:49 UTC, GitHub Actions and GitHub-hosted runners were degraded by a partial networking failure."
  - "During the roughly 90-minute peak, 47.0% of workflow runs on GitHub-hosted runners failed and 71.9% of hosted jobs did not start within five minutes."
  - "GitHub's incident summary says self-hosted runners were not affected by the October 5 incident."
  - "Job queue time, the gap between a job's created_at and started_at in the Actions API, shows a hosted runner incident before failures pile up."
  - "Setting runs-on from a configuration variable lets an operator move critical jobs to self-hosted runners without editing workflow files."
---

GitHub Actions and GitHub-hosted runners were degraded for about four hours on October 5, 2026, and [GitHub's incident summary](https://www.githubstatus.com/incidents/3q1yb5m7ltvb) says 47.0% of hosted workflow runs failed at the peak. Self-hosted runners were not affected. If your deploys and hotfixes run only on GitHub-hosted runners, add a queue-time alert and a way to move critical jobs to other runners now.

## What happened on October 5

GitHub's resolved summary on its [status page](https://www.githubstatus.com/incidents/3q1yb5m7ltvb) gives the window, cause, and impact. The cause, verbatim: "The incident was caused by a partial networking failure that disrupted connectivity between one of our on-premises datacenter regions and a subset of cloud-hosted regional database and storage services."

| Measure | Value |
| --- | --- |
| Window | 18:48 to 22:49 UTC |
| Hosted workflow runs not started within 5 minutes, full incident | 14.3% |
| Hosted jobs not started within 5 minutes, full incident | 26.5% |
| Hosted workflow runs that failed, ~90-minute peak | 47.0% |
| Hosted jobs not started within 5 minutes, ~90-minute peak | 71.9% |
| Self-hosted runners | Not affected |

GitHub mitigated it "by shifting database and storage traffic to healthy regions and endpoints and increasing capacity for affected compute services." Actions recovered by 21:54 UTC. Repository lists, licensing and billing pages, and some Copilot features also had intermittent errors. GitHub says it is working with its cloud provider on "network-path resilience, detection, and recovery for similar incidents."

![Timeline of the October 5 incident from 18:48 to 22:49 UTC, and bars showing 14.3%, 26.5%, 47.0%, and 71.9% impact figures on GitHub-hosted runners.](/diagrams/github-actions-outage-timeline.svg)

The first status post came at 19:11 UTC, 23 minutes after the impact start GitHub gives in its summary. Teams that waited for the status page lost those minutes.

## The rest of the week on githubstatus.com

October 5 was not the only Actions incident in the past seven days. From GitHub's status history:

| Date (UTC) | Incident | What GitHub said |
| --- | --- | --- |
| Oct 1, ~02:00 | [Workflow run failures after deployment gate approvals](https://www.githubstatus.com/incidents/dqn46wtvbdzv) | Actions lost execution state for a small number of runs. Retrying an approval does not restore it. |
| Oct 1, 14:47 to 17:56 | [Actions job delays](https://www.githubstatus.com/incidents/2dpbcq5j165n) | Hosted runner delays "due to throttling within an upstream Azure dependency", with requests returning 429. |
| Oct 7, 15:06 to 15:16 | [Git Operations, Pull Requests and Actions](https://www.githubstatus.com/incidents/djlmxz2zd0j7) | Widespread impact across services. |
| Oct 7, 16:52 to 17:01 | [Git Operations, Issues, Actions and Pull Requests](https://www.githubstatus.com/incidents/qpfv5p86dmrl) | "This incident is a reoccurrence of the incident from earlier in the day". |

As of October 8, 2026, GitHub had not published a root cause for the two October 7 incidents. Both pages say a detailed root cause analysis "will be shared as soon as it is available." Treat their cause as unknown until then.

## What this means for CI and deploy pipelines

- **Hosted runners are one failure domain for your pipelines.** When hosted runner assignment stalls, every job that uses them waits: deploys, hotfixes, and rollbacks alike.
- **Queue time moves first.** GitHub measured impact as jobs that "did not start within five minutes." Failures came later. A queue-time alert can fire early in an incident like this, before a status post appears.
- **Self-hosted runners helped on October 5, not always.** The October 5 summary says self-hosted runners were not affected. They still take jobs from GitHub's Actions service, so an incident in that service (the October 7 pages list Actions as a whole) can reach them too.
- **Retries during an incident add load and can repeat work.** The October 1 notice warns that a re-run "starts a new attempt, rebuilds artifacts, and requires fresh deployment approvals," and says to check "whether any deployment steps already completed to avoid repeating changes."

## What to do

### 1. Measure job queue time

Each job in the [workflow jobs REST API](https://docs.github.com/en/rest/actions/workflow-jobs) has `created_at` and `started_at`. The difference is queue time. This prints it per job for one run, with the runner labels:

```bash
gh api "repos/OWNER/REPO/actions/runs/RUN_ID/jobs" \
  | jq -c '.jobs[] | select(.started_at != null)
      | {name, labels, queued_s: ((.started_at|fromdateiso8601) - (.created_at|fromdateiso8601))}'
```

Collect it for recent runs on a schedule and alert when hosted jobs queue longer than five minutes, the same line GitHub used. Queued runs are also listed by `gh run list --status queued`.

### 2. Watch the Actions component directly

GitHub's status page exposes a JSON API. This prints `operational` when the Actions component is healthy:

```bash
curl -s https://www.githubstatus.com/api/v2/components.json \
  | jq -r '.components[] | select(.name=="Actions") | .status'
```

Use it to annotate your own alerts, not as the first signal. On October 5 it lagged the impact start by 23 minutes.

### 3. Add a runner switch for critical jobs

The [workflow syntax reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) allows `runs-on` to be "A single variable containing a string", and the [contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts) lists `vars` as available in `jobs.<job_id>.runs-on`. Point deploy and release jobs at a variable:

```yaml
jobs:
  deploy:
    runs-on: ${{ vars.DEPLOY_RUNNER }}
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh
```

Set the variable before you merge this. An unset configuration variable returns an empty string, per [GitHub's variables docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables).

```bash
# Normal state
gh variable set DEPLOY_RUNNER --org ORG --visibility all --body ubuntu-latest

# During a hosted runner incident: route to self-hosted runners labeled ci-fallback
gh variable set DEPLOY_RUNNER --org ORG --visibility all --body ci-fallback
```

The fallback runners must exist, be registered with the `ci-fallback` label, and have what the job needs before the incident. Test the switch on a quiet day.

### 4. Set job timeouts

The default `jobs.<job_id>.timeout-minutes` is 360. A job stuck on a degraded runner can hold a concurrency group or a deploy lock for six hours. Set a timeout close to the job's normal runtime plus margin.

### 5. Re-run with care after recovery

After GitHub reports recovery, re-run only what failed with `gh run rerun RUN_ID --failed`. For deploy jobs, first check whether the deploy step already ran, as GitHub's October 1 notice advises. Make deploy scripts safe to run twice.

### 6. Keep a break-glass deploy path

Write down how to ship a fix when Actions is down: who can run the deploy, from where, with which credentials, and how it gets logged. The October 7 incidents also hit Git Operations and Pull Requests, so the path should not depend on merging a PR on GitHub.

For more on what changed in GitHub this month, see the [GitHub App ghs_ token format change](/github-app-stateless-installation-tokens/). For the risk of who can publish from a workflow, see the [@subql/common trusted publishing compromise](/subql-npm-trusted-publishing-compromise/).
