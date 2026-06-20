---
title: Fleet reliability & automation
summary: >-
  Deployment automation and fleet-wide observability for a distributed
  production system — rollouts, health monitoring, and remote incident
  response built to keep mean-time-to-recovery low.
kind: "prod"
tags: ["AWS", "Greengrass", "Docker", "Datadog", "Python"]
status: live
order: 1
---

## The system

A distributed production system spread across many remote nodes, each running
containerized workloads I rarely touch in person. Nodes are managed as AWS IoT
Greengrass core devices: components ship as versioned, signed deployments, and
the workload runs in Docker. Every operation has to be safe to run blind — at
3am, across the whole fleet, with no console when it matters.

## What I own

- **Deployment automation.** Versioned rollouts with safe, repeatable
  promotion — no hand-editing a box, no snowflakes.
- **Observability.** Health, connectivity, throughput, and resource pressure
  surfaced in Datadog and CloudWatch, with alerting tuned so that a quiet pager
  means a healthy fleet.
- **Incident response.** Tracing failures that look identical on a dashboard but
  diverge at the node — OOM kills, resource faults, dropped uplinks — back to
  their real root cause, then closing the gap so they can't recur.

## Why it's hard

Distributed, remote infrastructure is where "it works on my machine" goes to
die: limited memory, flaky links, heterogeneous hardware. The discipline that
keeps a cloud cluster healthy still applies — it just has to survive physics.

> _This case study is a work in progress — real numbers and architecture to come._
