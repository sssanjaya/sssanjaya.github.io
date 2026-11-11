---
title: "GCP europe-west2-b Outage: Why the Generators Never Started"
description: "A PLC read voltage on a disconnected feed and never started the generators, so a Google Cloud London zone went dark. Check your zonal blast radius."
date: 2026-11-11T11:15:24Z
tags: [sre, gcp, incident-response, postmortem, availability]
takeaways:
  - "On 20 Oct 2026 a Google Cloud data center hosting europe-west2-b lost power because its generator controller read live voltage on a feed whose breaker was open, so it never sent a start signal."
  - "The facility was in a single-feed maintenance posture, UPS batteries gave about five minutes, and both redundant PLCs ran identical logic, so the backup layers failed together."
  - "Google's report puts region-wide customer impact at 6 hours 8 minutes, with GKE at 7 hours 34 minutes and Apigee X returning 5xx errors for 7 hours 19 minutes."
  - "The zone failure reached zones a and c through capacity exhaustion, cross-zone control plane calls, replicas packed into one zone, and late failure detection."
  - "Inventory zonal resources, confirm surviving zones can absorb the lost zone's load, and check that quorum replicas really sit in three zones."
---

The diesel generators at a Google Cloud data center in London never got a start signal, because the controller that decides when to start them was reading voltage on a feed that was switched off. Feed A failed at 06:53 British Summer Time (BST) on 20 Oct 2026, the UPS batteries ran out minutes later, and zone `europe-west2-b` went dark, with region-wide disruption lasting 6 hours 8 minutes according to [Google's incident report published on 4 Nov](https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj). If you run in `europe-west2`, or in any multi-zone region, the useful part is how a single-zone power loss still broke services in the other two zones.

<figure>
  <img src="/diagrams/gcp-london-zone-outage-plc.svg" alt="Power path at the europe-west2-b facility. Utility feed A fails from an external cable fault. Utility feed B is live on the line side, but breaker B is open for repairs. The PLC voltage sensor sits upstream of the open breaker, reads voltage present, and both identical PLCs conclude utility power is healthy, so the diesel generator bank gets no start signal. UPS batteries with about 5 minutes of runtime carry the load until the halls go dark at 07:00 BST. Fix: start generators on undervoltage and check breaker position for both feeds." width="960" height="560" loading="lazy" />
  <figcaption>The sensor told the truth about the wrong point in the circuit: feed B had voltage, but none of it could reach the load. Source: <a href="https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj">Google Cloud incident report</a>.</figcaption>
</figure>

## What was supposed to happen

The report describes a 2N power design: two independent utility feeders, A and B, each able to carry the full critical load, plus a standby utility connection for manual transfers. Behind that sits a generator bank run by a "dual-redundant Programmable Logic Controller (PLC)". Uninterruptible power supply (UPS) batteries provide "approximately five minutes of autonomous runtime", which is the window for the PLC to detect undervoltage, start the diesels, synchronize them, and move the load.

On paper, losing a feed costs nothing, and losing both costs a generator start.

## What happened instead

A quarterly generator load test on 14 Oct found issues on the B side. To repair them, the site opened the feeder B breaker and ran in a "temporary single-feed (1N) bridged maintenance posture". Feed A carried everything.

On 19 Oct at 22:53 US/Pacific (06:53 BST on 20 Oct), an underground cable fault on the utility network outside the site killed feed A. That left the site with no utility power, which is exactly the case the generators exist for.

The PLC did not start them. From the report:

> The PLC was programmed to verify whether voltage was present on the line side of the feeder before commanding a generator start.

Feed B was still energized upstream of its open breaker. The sensor saw that voltage, so the logic decided a healthy utility source was available. The active and standby PLCs ran "identical control logic" and read the same "shared upstream sensors", so the redundant controller made the same wrong call. When the on-site team tried a remote load transfer through the PLC, the system blocked it for the same reason.

The team then transferred the facility load to the standby utility source. The batteries ran out during that process.

## Why every backup layer failed at once

Each layer of redundancy was real, and each one was spent or bypassed by the same event:

| Layer | Designed for | State at 06:53 BST |
| --- | --- | --- |
| Feed B | Carry load if feed A fails | Breaker open for repairs |
| Generator bank | Carry load if both feeds fail | Never told to start |
| Standby PLC | Take over if the active PLC fails | Same logic, same sensors, same answer |
| UPS batteries | Bridge about five minutes | Bridged, then depleted |
| Standby utility | Manual transfer | Worked, after the halls lost power |

Maintenance turned 2N into 1N, and the sensor wiring meant the remaining automatic layer depended on the breaker being closed. This is a common-mode failure: two controllers that share inputs and code are one controller for any fault in those inputs or that code.

## How long it took to come back

Power came back to the data halls at 08:20 BST, 80 minutes after the zone went dark. Getting services back took about four more hours, mostly for storage. The report says storage devices with unclean shutdowns began recovery at 08:50, and responders "chose not to restore services that would otherwise make this worse".

<figure>
  <img src="/diagrams/gcp-london-zone-outage-timeline.svg" alt="Timeline in BST on 20 Oct 2026. 06:53 feed A cable fault and no generator start. 07:00 UPS runs out and zone b loses power. 07:04 monitoring alerts engineers. 07:09 failover to zones a and c saturates capacity. 07:54 standby utility power restored. 08:20 power back in the data halls. 08:50 storage recovery begins. 11:45 controlled traffic re-admission. 12:29 core disruption ends. 13:08 99.5% of Compute Engine VMs healthy. The zone was dark for 80 minutes and storage recovery took 205 minutes." width="960" height="580" loading="lazy" />
  <figcaption>The zone was dark for 80 minutes; the next 205 minutes went to storage recovery before traffic was let back in. Times converted from the report's US/Pacific to BST. Source: <a href="https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj">Google Cloud incident report</a>.</figcaption>
</figure>

Engineers were alerted at 07:04 BST by "automated monitoring systems and probers", four minutes after impact began. The long pole was storage integrity, not detection.

## How a zone outage broke three zones

Google states that losing zone-scoped resources in `-b` is "working within the design of a zonally-scoped system". A Compute Engine VM, a zonal Persistent Disk, a zonal Google Kubernetes Engine (GKE) cluster, or a non-high-availability (HA) Cloud SQL instance in `-b` is expected to go down with the zone.

The surprise is the impact outside the zone. The report names "Instantaneous demand surges on neighboring zones (a and c)" and "Control-plane dependencies across zonal boundaries" as the primary causes, and the per-product sections add two more patterns.

<figure>
  <img src="/diagrams/gcp-london-zone-outage-escape.svg" alt="Region europe-west2 with zone b out of power and failover load flowing into zones a and c. Four paths carried the failure out: 1, capacity surge, where some Compute Engine failovers failed on capacity, GKE scale-ups slowed and a BigQuery data plane job could not autoscale; 2, regional control planes timed out on calls to metadata in zone b, causing 500 and 503 errors; 3, Apigee X had 2 of 3 datastore replicas in zone b, lost quorum and returned 5xx errors for 7 hours 19 minutes; 4, AlloyDB regional primaries waited up to 95 minutes for failover notifications and about 4% stalled." width="960" height="560" loading="lazy" />
  <figcaption>None of these four needed zone a or c to fail; each one made a healthy zone depend on the dead one. Source: <a href="https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj">Google Cloud incident report</a>.</figcaption>
</figure>

**Capacity.** At 07:09 BST traffic and workloads failed over to zones a and c, and the influx "saturated available compute slots and processing capacity". Some Compute Engine failovers "were unsuccessful due to capacity constraints". GKE regional clusters lost their `-b` nodes, and scale-ups in the surviving zones "were impacted by available capacity". BigQuery's impact came from "an autoscaling dependency in a critical data plane job, which was unable to scale up during the failover".

**Control plane calls into the dead zone.** Regional control planes made cross-zone calls to "metadata and catalog components in the offline zone", which timed out and produced "intermittent 500 and 503 API errors across the region". BigQuery customers not assigned to the zone saw a 1% error rate on Job API calls from "overly broad concurrency throttling".

**Replica placement.** Apigee X keeps datastore replicas across three zones, but "a scheduling misconfiguration had placed two of three replicas in the zone that lost power, so the datastore lost quorum". With two of three replicas in one zone, losing that zone loses the majority.

**Detection and stuck failovers.** AlloyDB regional primaries "experienced up to a 95-minute delay in starting automated failovers due to delayed failover notifications", and "~4%" stalled on Persistent Disk issues and needed manual recovery. Cloud SQL HA instances failed over at once unless they hit Regional Persistent Disk failures. Bigtable multi-cluster instances with HA routing failed over as designed.

<figure>
  <img src="/diagrams/gcp-london-zone-outage-durations.svg" alt="Horizontal bar chart of impact duration in minutes. GKE product incident 454 minutes (7 h 34 min). Apigee X runtime 5xx errors 439 (7 h 19 min). Region-wide impact headline 368 (6 h 8 min). Zone-scoped resources down 329 (5 h 29 min). BigQuery disruption 309 (5 h 9 min)." width="960" height="400" loading="lazy" />
  <figcaption>The two longest bars are regional services, not zonal ones: GKE and Apigee X outlasted the zone's own outage. Source: <a href="https://status.cloud.google.com/incidents/Xs2XTHzAVC9YnafnPyzj">Google Cloud incident report</a>.</figcaption>
</figure>

A steady 1% error rate is a 10x burn against a 99.9% service level objective (SLO). As the [burn-rate alerting walkthrough](/slo-burn-rate-alerts-prometheus/) shows, that rate never trips the fast 1h/5m pair and pages only through the 6h/30m pair, after 216 minutes. A partial regional degradation like this one can sit below fast-burn alerts for hours.

## What Google is changing

Selected action items from the report, as listed on 4 Nov:

- PLC logic reconfigured and validated on 20 Oct and again on 26 Oct to check undervoltage and breaker status.
- A review of PLC configurations at other sites "with similar topologies and PLC manufacturers", estimated 15 Nov.
- A planned-maintenance freeze at sites with similar topologies, completed 30 Oct.
- An updated emergency operating procedure with manual generator restart and transfer steps, practiced "twice per shift" by the on-site team.
- Apigee X will "strictly enforce" three replicas in three different zones, and now alerts on replica drift.

Several items were still open when this post was checked on 11 Nov 2026, including the feed A cable repair (estimated 13 Nov) and full generator transfer tests on both restored feeds (estimated 17 Nov).

## What to check in your own setup

1. **List what dies with one zone.** For each region, find resources pinned to a single zone. These commands use fields from the Cloud SQL and GKE APIs:

   ```bash
   gcloud compute instances list --zones=europe-west2-b
   gcloud sql instances list \
     --filter="settings.availabilityType=ZONAL" \
     --format="table(name,region,gceZone,settings.availabilityType)"
   gcloud container clusters list \
     --filter="location ~ -[a-z]$" \
     --format="table(name,location)"
   ```

   The last filter matches cluster locations that end in a zone letter, such as `europe-west2-b`, so it lists zonal clusters only.
2. **Size the surviving zones for the lost one.** If you run three zones at 70% each, losing one asks the other two for 105%. Use reservations or headroom for the workloads that must fail over, because capacity in a and c was the bottleneck here.
3. **Check quorum placement, not replica count.** For every three-replica system (etcd, ZooKeeper, Kafka controllers, consensus databases), confirm each replica's actual zone. Kubernetes `topologySpreadConstraints` with `whenUnsatisfiable: DoNotSchedule` enforce this at schedule time.
4. **Find control plane calls that cross zones.** Look for regional services that synchronously call a zonal dependency on their request path, and give those calls short timeouts and a degraded mode.
5. **Treat maintenance as reduced redundancy.** Any change that drops you from N+1 to N, like draining a zone, taking a replica down, or pausing a standby, should be visible on the on-call dashboard and should block other risky changes until it ends.
6. **Test that failover signals measure the real path.** A health check or sensor should observe the thing you depend on, the same way the PLC needed breaker position and not upstream line voltage. Exercise failover with the backup in its maintenance state, not only in its normal state.
