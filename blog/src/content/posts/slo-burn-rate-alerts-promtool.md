---
title: "SLO Burn Rate Alerts: 3 Incidents Tested With promtool"
description: "A 1% error-rate alert paged for a 10-minute blip and missed a 24-hour burn. promtool 3.16.0 tests show how burn-rate alerts get both right."
date: 2026-11-22T12:14:15Z
tags: [prometheus, slo, alerting, reliability]
takeaways:
  - "A fixed error-rate > 1% for 5m alert paged for a blip that burned 0.46% of a 30-day error budget and stayed silent for a 24-hour burn that consumed 26.7% of it."
  - "A burn-rate alert compares the error ratio to a multiple of the error budget over a long and a short window, so it pages on budget spent, not on how tall the spike is."
  - "With the SRE Workbook pair of burn rate 14.4 over 1h and 5m plus burn rate 6 over 6h and 30m, a 0.8% error rate pages after 4 hours 30 minutes, when 5% of the monthly budget is gone."
  - "promtool test rules replays synthetic counters through real alert rules and asserts the exact minute each alert fires, so alert thresholds can be tested in CI like code."
---

An alert on `error rate > 1% for 5m` paged for an incident that burned 0.46% of the monthly error budget, and stayed silent through one that burned 26.7%. Both results come from running the rule through `promtool test rules` on Prometheus 3.16.0, the [current release](https://prometheus.io/download/), with a 99.9% service level objective (SLO). The fix is the multiwindow, multi-burn-rate alert from the [Google SRE Workbook](https://sre.google/workbook/alerting-on-slos/), and the same test file proves it pages on the right two incidents out of three.

<figure>
  <img src="/diagrams/slo-burn-rate-alerts-promtool-results.svg" alt="Bar chart of the share of a 30-day error budget burned by three incidents at a 99.9% SLO, with each alert's result. 2% errors for 10 minutes burned 0.46%: HighErrorRate paged at 8 minutes, ErrorBudgetBurn stayed silent. 20% errors for 30 minutes burned 13.9%: HighErrorRate paged at 6 minutes, ErrorBudgetBurn at 5 minutes. 0.8% errors for 24 hours burned 26.7%: HighErrorRate stayed silent, ErrorBudgetBurn paged at 4 hours 30 minutes." width="920" height="500" loading="lazy" />
  <figcaption>The fixed threshold paged for the smallest incident and missed the largest. The burn-rate alert ignored the blip and caught both real ones. Source: sandbox run of promtool 3.16.0 rule unit tests.</figcaption>
</figure>

## Why a fixed threshold gets it wrong twice

A threshold alert asks one thing: is the error ratio above X right now. It has no idea how much budget that costs.

A 99.9% SLO over 30 days leaves an error budget of 0.1% of requests. At 100 requests per second that is 259,200 failed requests per 30 days. Two very different incidents show the problem:

- **2% errors for 10 minutes** is 1,200 failed requests, 0.46% of the budget. It is over 1%, so the alert pages.
- **0.8% errors for 24 hours** is 69,120 failed requests, 26.7% of the budget. It is under 1%, so the alert never fires.

Lowering the threshold to catch the second case makes the first one worse. The workbook's own example of a threshold set at the SLO: "A 0.1% error rate for 10 minutes would alert, while consuming only 0.02% of the monthly error budget." Taken to the limit, it says, "you could receive up to 144 alerts per day every day, not act upon any alerts, and still meet the SLO."

## How a burn-rate alert decides

The workbook defines the unit: "Burn rate is how fast, relative to the SLO, the service consumes the error budget." Burn rate 1 spends exactly the whole budget over the SLO period. For a 99.9% SLO, a 0.8% error ratio is burn rate 8, which empties a 30-day budget in 3.75 days.

The alert fires when the burn rate is high over a long window **and** over a short one. The long window measures how much budget is gone. The short window is there, in the workbook's words, "to check if the error budget is still being consumed as we trigger the alert", so the alert clears soon after the errors stop. The workbook's guideline is to make the short window 1/12 of the long one.

Its recommended starting tiers for a 99.9% SLO:

| Severity | Long window | Short window | Burn rate | Budget consumed when it fires |
| --- | --- | --- | --- | --- |
| Page | 1 hour | 5 minutes | 14.4 | 2% |
| Page | 6 hours | 30 minutes | 6 | 5% |
| Ticket | 3 days | 6 hours | 1 | 10% |

The lab below implements the two paging tiers.

## The rules under test

`slo-alerts.yml` holds four recording rules for the error ratio, the common threshold alert, and the two burn-rate alerts. The 30m, 1h and 6h recording rules are the 5m rule with a different range.

```yaml
groups:
  - name: api-slo
    interval: 1m
    rules:
      - record: job:slo_errors_per_request:ratio_rate5m
        expr: sum by (job) (rate(http_requests_total{code=~"5.."}[5m])) / sum by (job) (rate(http_requests_total[5m]))
      # ...same for ratio_rate30m, ratio_rate1h, ratio_rate6h

      # The common alert: a fixed threshold on a short window.
      - alert: HighErrorRate
        expr: job:slo_errors_per_request:ratio_rate5m > 0.01
        for: 5m
        labels:
          severity: page

      # Burn-rate alerts for a 99.9% SLO (error budget 0.001).
      - alert: ErrorBudgetBurn
        expr: |
          job:slo_errors_per_request:ratio_rate1h > (14.4 * 0.001)
          and
          job:slo_errors_per_request:ratio_rate5m > (14.4 * 0.001)
        labels:
          severity: page
          burn: fast
      - alert: ErrorBudgetBurn
        expr: |
          job:slo_errors_per_request:ratio_rate6h > (6 * 0.001)
          and
          job:slo_errors_per_request:ratio_rate30m > (6 * 0.001)
        labels:
          severity: page
          burn: slow
```

The burn-rate alerts have no [`for` clause](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/). The two windows already do the job of filtering out blips.

## Replaying incidents with promtool test rules

[`promtool test rules`](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/) takes synthetic series, evaluates the rule file against them, and checks which alerts fire at each `eval_time`. No Prometheus server runs. Each test here starts with 6 hours of clean traffic so the 6h window has full history, then injects errors. This is the slow-burn test:

```yaml
rule_files:
  - slo-alerts.yml
evaluation_interval: 1m
tests:
  - name: 0.8% errors for 24 hours
    interval: 1m
    input_series:
      - series: 'http_requests_total{job="api", code="200"}'
        values: '0 6000+6000x359 2165952+5952x1439 10736880+6000x479'
      - series: 'http_requests_total{job="api", code="500"}'
        values: '0 0+0x359 48+48x1439 69120+0x479'
    alert_rule_test:
      - eval_time: 10h29m
        alertname: ErrorBudgetBurn
        exp_alerts: []
      - eval_time: 10h30m
        alertname: ErrorBudgetBurn
        exp_alerts:
          - exp_labels: {alertname: ErrorBudgetBurn, job: api, severity: page, burn: slow}
      - eval_time: 30h
        alertname: HighErrorRate
        exp_alerts: []
```

`48+48x1439` means: start at 48, then 1,439 more samples, each 48 higher. With one sample per minute that is 48 errors a minute for 24 hours, against 6,000 requests a minute. The errors start after the 6h mark, so `10h30m` is 4 hours 30 minutes into the incident.

Running the full file, with one test per incident:

```console
$ promtool --version
promtool, version 3.16.0 (branch: HEAD, revision: e2e28adeee2c5883d000fc82aca6008cfbf7e96d)
$ promtool check rules slo-alerts.yml
Checking slo-alerts.yml
  SUCCESS: 7 rules found

$ promtool test rules slo-alerts.test.yml
Processing test file: slo-alerts.test.yml
  SUCCESS
```

Asserting the opposite, that `HighErrorRate` is firing at the end of the 24-hour burn, shows what a failure looks like:

```console
$ promtool test rules broken.test.yml
Processing test file: broken.test.yml
  FAILED:
    name: slow burn must page,
    alertname: HighErrorRate, time: 1d6h, 
        exp:[
            0:
              Labels:{alertname="HighErrorRate", job="api", severity="page"}
              Annotations:{}
            ], 
        got:[]
```

`got:[]` after 24 hours of errors: the threshold alert never saw them.

## The slow burn, window by window

<figure>
  <img src="/diagrams/slo-burn-rate-alerts-promtool-slow-burn.svg" alt="Line chart for 0.8% errors starting at hour 0. The 5-minute and 30-minute error ratios rise to 0.8% and stay below the 1% HighErrorRate threshold. The 6-hour error ratio climbs in a straight line and crosses the 0.6% burn-rate-6 threshold at 4 hours 30 minutes, when ErrorBudgetBurn pages with 5% of the monthly budget consumed." width="920" height="540" loading="lazy" />
  <figcaption>The short windows flatten at 0.8% within 30 minutes and never touch the 1% line. The 6h window keeps climbing and crosses 0.6% at 4 h 30 min. Source: recording rule values from a sandbox run of promtool 3.16.0.</figcaption>
</figure>

The 5m and 30m ratios reach 0.8% and stop. Only the 6h window accumulates, and it crosses 0.6% (burn rate 6) when 0.8% × 4.5 h equals 0.6% × 6 h. At that minute 12,960 requests have failed, exactly 5% of the 30-day budget, which matches the workbook's table. The alert stays on for the rest of the 24 hours and resolves 8 minutes after the errors stop.

The blip takes the other path. 2% for 10 minutes averages 0.33% over an hour, far below the 1.44% that burn rate 14.4 needs, so `ErrorBudgetBurn` stays quiet. `HighErrorRate` fires at minute 8 and resolves at minute 12, a page for something already over.

## The real outage: no slower, clears on its own

<figure>
  <img src="/diagrams/slo-burn-rate-alerts-promtool-outage-timeline.svg" alt="Timeline for 20% errors lasting 30 minutes. ErrorBudgetBurn with burn=fast fires from minute 5 to minute 34. HighErrorRate fires from minute 6 to minute 34. ErrorBudgetBurn with burn=slow fires from minute 11 to minute 59, which is 29 minutes after the errors stop." width="920" height="420" loading="lazy" />
  <figcaption>On a real outage the fast burn tier pages one minute before the threshold alert and clears with it. The slow tier lingers for 29 minutes after recovery. Source: sandbox run of promtool 3.16.0.</figcaption>
</figure>

A common worry is that long windows make alerts slow. With 20% errors, the 1h average passes 1.44% in the fifth minute, so the fast tier pages at minute 5 with 2.3% of the budget gone. `HighErrorRate` crosses its threshold sooner but then waits out `for: 5m` and pages at minute 6.

Both clear 4 minutes after the errors stop, because the 5m window drains. The slow tier is the cost: its 30m window keeps it firing until minute 59.

One limit from the workbook applies to all of this: "these approaches can cause problems for systems that receive a low rate of requests." With a few requests an hour, one failure is a huge burn rate.

## What to do

1. Write down the SLO and period for one service, then compute its budget: `(1 - SLO) × requests per period`.
2. Add recording rules for the error ratio over 5m, 30m, 1h and 6h, and the two `ErrorBudgetBurn` rules above with `0.001` replaced by your budget.
3. Write a `promtool` test with at least three cases: a short blip that must not page, a hard outage that must page within minutes, and a slow burn under your old threshold that must page.
4. Run `promtool check rules` and `promtool test rules` in CI on every change to the rule files. The binary ships next to `prometheus` in the `prom/prometheus` image.
5. Run the new alert beside the old threshold alert for a few weeks, compare which pages needed action, then delete the old one.
6. Add the 3-day, burn rate 1 tier as a ticket, not a page.
