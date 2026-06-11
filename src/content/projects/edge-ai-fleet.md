---
title: Edge AI fleet operations
summary: >-
  Provisioning, observability, and remote operations for 40+ ARM devices
  running computer-vision inference across live retail sites — AWS IoT
  Greengrass, containerized workloads, Datadog monitoring.
kind: "EDGE / IOT · PRODUCTION"
tags: ["Greengrass", "Docker", "RK3588", "Datadog"]
status: live
order: 1
---

## The system

A fleet of 40+ ARM single-board computers (Rockchip RK3588 — Khadas and
Firefly boards) deployed to live retail sites, each running containerized
computer-vision inference against camera streams. Devices are managed as AWS
IoT Greengrass core devices; components ship as versioned deployments, and the
inference workload runs in Docker against the on-board NPU.

## What I own

- **Fleet operations.** Remote diagnostics, deployment rollouts, and recovery
  for devices I rarely physically touch — every operation has to be safe to run
  blind, at 3am, across a fleet.
- **Observability.** Health, camera connectivity, inference throughput, and
  resource pressure surfaced in Datadog and CloudWatch, with alerting tuned so
  that a quiet pager means a healthy fleet.
- **Incident response.** Tracing failures that look identical on a dashboard but
  diverge at the device — OOM kills, NPU access faults, RTSP drops — back to
  their real root cause on the box.

## Why it's hard

Edge is where "it works on my machine" goes to die. Limited memory, flaky
uplinks, heterogeneous hardware, and no console when it matters. The discipline
that keeps a cloud cluster healthy still applies — it just has to survive
physics.

> _Replace this body with the real story and numbers when you're ready —
> it's a markdown file you own._
