---
id: runbooks/hpa-maxed-out.md@v2
source: runbooks
type: runbook
title: "KubeHpaMaxedOut"
url: https://runbooks.castlane.internal/hpa-maxed-out/v2
service: [feed-builder, transcoder, cdn-edge]
alerts: [KubeHpaMaxedOut]
allowed_groups: [eng, contractors]
author: rs
version: 2
effective_at: 2025-09-09
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-09-09T14:31:00Z
generated: true
---
# KubeHpaMaxedOut

This alert means a deployment has reached the top of its HorizontalPodAutoscaler target range, so Kubernetes cannot add more pods even though demand is still rising. In Castlane, the main services are `feed-builder` in `feeds`, `transcoder` in `media`, and `cdn-edge` in `edge`. The owning teams are feeds, media, and edge respectively, and the first step is to check whether this is only capacity pressure or part of a user-facing latency or lag problem.

Dashboard: https://grafana.castlane.internal/d/kube-hpa-maxedout

## Alerts that link here

- `KubeHpaMaxedOut`

## Diagnosis

1. Confirm which deployment is maxed out and whether the alert is still active.

```bash
amtool alert query alertname=KubeHpaMaxedOut --active
kubectl --context prod-us-east -n feeds get hpa
kubectl --context prod-us-east -n media get hpa
kubectl --context prod-us-east -n edge get hpa
```

2. Check the live HPA target, current replicas, and ceiling. Look for one of the known service ranges:
   - `feed-builder`: 6 to 40
   - `transcoder`: 10 to 30
   - `cdn-edge`: 12 to 60

```bash
kubectl --context prod-us-east -n feeds describe hpa feed-builder
kubectl --context prod-us-east -n media describe hpa transcoder
kubectl --context prod-us-east -n edge describe hpa cdn-edge
```

3. Check whether the maxed-out HPA is causing symptoms. Use the service dashboards and PromQL to see if there is latency, backlog, or error growth. Maxed out by itself is not an incident.

```promql
# pod count at ceiling
kube_horizontalpodautoscaler_status_current_replicas{namespace="feeds", horizontalpodautoscaler="feed-builder"}
  == kube_horizontalpodautoscaler_spec_max_replicas{namespace="feeds", horizontalpodautoscaler="feed-builder"}

# feed-builder lag pressure
rate(feed_build_jobs_total[5m])

# transcoder queue pressure
redis_queue_length{queue="transcode"}

# cdn-edge request latency
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{namespace="edge",service="cdn-edge"}[5m])))
```

4. Check for the linked Castlane alerts. If `feed-builder` is maxed out, look for `FeedBuildLagHigh`. If `transcoder` is maxed out, look for `TranscodeQueueBacklog`. If `cdn-edge` is maxed out, check for elevated request latency and 5xx rates in Grafana, plus any `TargetDown` or `KubePodNotReady` noise.

```bash
amtool alert query alertname=FeedBuildLagHigh --active
amtool alert query alertname=TranscodeQueueBacklog --active
kubectl --context prod-us-east -n feeds get pods -o wide
kubectl --context prod-us-east -n media get pods -o wide
kubectl --context prod-us-east -n edge get pods -o wide
```

5. Check whether the cluster has room for more pods. Raising a max requires node capacity, so confirm with platform before changing anything. If the deployment is `feed-builder`, do not raise it without asking data platform first, because more pods means more database clients.

```bash
kubectl --context prod-us-east top nodes
kubectl --context prod-us-east -n feeds top pods
kubectl --context prod-us-east -n media top pods
kubectl --context prod-us-east -n edge top pods
```

## Mitigation

1. If the service is healthy and there is no lag or latency alert, acknowledge the alert and continue to watch it. This often clears after a traffic spike.

2. If user impact is real, scale carefully. First confirm node headroom with platform, then raise the HPA max only enough to relieve pressure.

```bash
# Example only, use the service's real HPA and a reason note
kubectl --context prod-us-east -n media patch hpa transcoder --type merge -p '{"spec":{"maxReplicas":36}}'
```

3. For `feed-builder`, coordinate with data platform before any increase. The service can add load to Postgres through additional clients, so a higher max can move the bottleneck instead of fixing it.

4. If the cluster is short on capacity, ask platform to add nodes before changing the HPA ceiling. Do not force higher replica counts onto a saturated node pool.

5. If a deployment is stuck due to a bad rollout or repeated pod restarts, handle that separately with the standard Kubernetes alert path. This runbook is only for the HPA ceiling condition.

## Escalation

- Escalate to `#platform` when node capacity is the blocker or when you need help judging safe headroom.
- Escalate to `#feeds-dev` for `feed-builder` maxouts, especially if `FeedBuildLagHigh` is active.
- Escalate to `#media` for `transcoder` maxouts with a growing transcode queue.
- Escalate to `#edge` for `cdn-edge` maxouts with elevated latency or error rates.
- If there is evidence of a broader platform issue, open a ticket with the relevant prefix, `FEED-`, `MEDIA-`, or `EDGE-`, and include the dashboard link and the HPA describe output.

## HPA settings

| Service | Namespace | HPA min | HPA max | Notes |
|---|---|---:|---:|---|
| feed-builder | feeds | 6 | 40 | Ask data platform before increasing |
| transcoder | media | 10 | 30 | Check queue backlog first |
| cdn-edge | edge | 12 | 60 | Check request latency and 5xx rate |

## History

- 2025-08-14, version 1, initial Castlane addendum for HPA maxed out alerts on `feed-builder`, `transcoder`, and `cdn-edge`.
- 2025-09-03, version 1.1, added explicit checks for linked lag and latency alerts, plus node headroom validation.
- 2025-09-09, version 2, clarified the service-specific HPA ranges and the requirement to ask platform before raising the ceiling, with data platform review for `feed-builder`.
