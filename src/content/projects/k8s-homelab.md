---
title: Kubernetes homelab
summary: >-
  A three-node k3s cluster managed entirely by GitOps with a full
  Prometheus/Grafana stack — the proving ground for anything before it
  touches production.
kind: "PLATFORM · HOMELAB"
tags: ["k3s", "ArgoCD", "Grafana"]
status: live
order: 2
---

## The proving ground

A three-node [k3s](https://k3s.io) cluster running at home, managed the same way
I'd run production: declaratively, version-controlled, and observable. Nothing
gets deployed by hand — ArgoCD reconciles the cluster to whatever is in git.

## What runs on it

- **GitOps delivery** with ArgoCD — the cluster is a pure function of the repo.
- **Observability** with Prometheus and Grafana, so I'm dogfooding the same
  signals I rely on at work.
- **Whatever I'm testing this week** — new controllers, chaos experiments,
  upgrade rehearsals, and ideas that aren't allowed near real users yet.

## Why bother

The best way to stay sharp on the platform is to operate one you own. When a new
pattern works here, I trust it; when it breaks here, it breaks on my time
instead of someone else's.

> _Swap in your real topology and a photo of the rack when you're ready._
