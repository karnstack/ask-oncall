---
id: runbooks/cpu-throttling.md@v1
source: runbooks
type: runbook
title: "CPUThrottlingHigh on transcoder and feed-builder"
url: https://runbooks.castlane.internal/cpu-throttling/v1
service: [transcoder, feed-builder]
alerts: [CPUThrottlingHigh]
allowed_groups: [eng, contractors]
author: rs
version: 1
effective_at: 2025-06-10
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-06-10T15:38:00Z
generated: true
---
# CPUThrottlingHigh on transcoder and feed-builder

This alert covers CPU throttling in the `media` and `feeds` namespaces for `transcoder` and `feed-builder`. `transcoder` is expected to throttle while `ffmpeg` is active, so some throttling is normal and the alert is muted for `container="transcoder"` below 50 percent. `feed-builder` throttling is different, it can delay feed rebuilds and increase feed lag, so treat sustained throttling there as service impacting. Owner team: `rs` and the feed and media oncall paths.

Dashboard: https://grafana.castlane.internal/d/cpu-throttling-high

## Alerts that link here

- `CPUThrottlingHigh`

## Diagnosis

1. Confirm which workload is throttling and whether it is sustained or just bursty. Start with the dashboard and then check Prometheus for the throttling ratio over the last 30 minutes.

```promql
sum by (namespace, deployment, container) (
  rate(container_cpu_cfs_throttled_seconds_total{namespace=~"media|feeds", deployment=~"transcoder|feed-builder"}[5m])
)
/
sum by (namespace, deployment, container) (
  rate(container_cpu_usage_seconds_total{namespace=~"media|feeds", deployment=~"transcoder|feed-builder"}[5m])
)
```

2. Check the current pods, restarts, and whether either deployment is hitting its CPU limit hard. Use the service namespace that matches the workload.

```bash
kubectl --context prod-us-east -n media get deploy,pods -l app=transcoder -o wide
kubectl --context prod-us-east -n feeds get deploy,pods -l app=feed-builder -o wide
kubectl --context prod-us-east -n media describe deploy transcoder
kubectl --context prod-us-east -n feeds describe deploy feed-builder
```

3. For `transcoder`, verify whether the throttling aligns with active transcode work. `ffmpeg` is CPU heavy, so short throttling spikes are expected during busy periods.

```bash
kubectl --context prod-us-east -n media logs deploy/transcoder --since=20m | grep -E 'ffmpeg|transcode|segment'
```

4. For `feed-builder`, look for backlog or repeated rebuilds. Throttling here usually shows up as slow feed rebuild completion and then rising lag.

```bash
kubectl --context prod-us-east -n feeds logs deploy/feed-builder --since=30m
kubectl --context prod-us-east -n feeds logs deploy/feed-builder | grep -E 'rebuild|lag|retry|timeout'
```

5. Check whether the CPU limit is too tight for the current workload. Limits are set per deployment and should not be removed. If the workload changed recently, compare the live manifest to the intended values.

```bash
kubectl --context prod-us-east -n media get deploy transcoder -o yaml | sed -n '/resources:/,/env:/p'
kubectl --context prod-us-east -n feeds get deploy feed-builder -o yaml | sed -n '/resources:/,/env:/p'
```

6. If the alert fired on `feed-builder`, confirm whether feed lag is increasing and whether rebuild work is backing up.

```promql
max_over_time(feed_build_lag_seconds{namespace="feeds"}[30m])
```

## Mitigation

1. Do not remove CPU limits. If `transcoder` is only briefly throttling during `ffmpeg`, and the ratio stays below 50 percent, no action is needed.

2. If `feed-builder` is throttling and lag is rising, increase the CPU limit for the deployment using the normal rollout path. Keep the change small and targeted, then watch both throttling and lag for 15 to 30 minutes.

```bash
kubectl --context prod-us-east -n feeds set resources deploy/feed-builder --limits=cpu=1500m,memory=1536Mi --requests=cpu=750m,memory=1024Mi
kubectl --context prod-us-east -n feeds rollout status deploy/feed-builder
```

3. If `transcoder` is throttling with a matching rise in the transcode queue backlog, first confirm the pods are healthy, then raise CPU only if the queue is not draining and the throttling ratio is clearly above the normal `ffmpeg` pattern.

```promql
max_over_time(redis_queue_depth{namespace="media", queue="transcode"}[15m])
```

4. If the alert is noisy but service health is normal, leave the limit in place and let the alert clear. The alert is intentionally muted for `container="transcoder"` below 50 percent to avoid paging on expected `ffmpeg` bursts.

## Escalation

- Escalate to `#media` if `transcoder` throttling is sustained above normal and the transcode queue backlog keeps rising for more than 20 minutes.
- Escalate to `#feeds-dev` if `feed-builder` throttling is paired with rising feed lag or repeated rebuild failures.
- If the rollout does not take effect, or the deployment keeps reverting, page `rs` and `ok` in `#platform` and open a `PLAT-` ticket.
- If you suspect a node level issue, check for standard Kubernetes alerts on the affected node and hand off to the platform rotation with the node name, namespace, and start time.

## History

- 2025-06-10, version 1. Initial runbook for `CPUThrottlingHigh` on `transcoder` and `feed-builder`, with PromQL-based throttling checks and deployment level CPU mitigation.
- 2025-06-10, version 1. Clarified that `transcoder` throttling is expected during `ffmpeg` runs and that the alert is muted below 50 percent for `container="transcoder"`.
- 2025-06-10, version 1. Added feed lag validation for `feed-builder` and kept the guidance to adjust limits without removing them.
