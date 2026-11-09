---
id: runbooks/exporter-target-down.md@v1
source: runbooks
type: runbook
title: "TargetDown for our exporters"
url: https://runbooks.castlane.internal/exporter-target-down/v1
service: [platform, pgbouncer-feeds, redis-feeds]
alerts: [TargetDown]
allowed_groups: [eng, contractors]
author: yu
version: 1
effective_at: 2025-09-30
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-09-30T13:20:00Z
generated: true
---
# TargetDown for our exporters

This runbook covers `TargetDown` alerts for exporter sidecars in `pgbouncer-feeds` and `redis-feeds`. These exporters run inside the database and Redis pods, so when they go down we lose visibility into pool saturation and Redis health, which means we also lose the Castlane alerts that depend on those metrics. The affected services live in the `feeds` and `platform` area, and the usual owner teams are `feeds` for PgBouncer and `platform` for Redis.

## Alerts that link here

- `TargetDown`

## Diagnosis

1. Confirm which target is down in Alertmanager or Grafana.

```bash
amtool alert query alertname=TargetDown
```

Open the alert in Grafana, then check the label set. The screenshot you want in your head is the alert details page showing either `job="pgbouncer_exporter"` or `job="redis_exporter"`, plus the namespace and pod labels.

2. Find the affected pod and check whether the exporter sidecar is ready.

```bash
kubectl --context prod-us-east -n feeds get pods -l app=pgbouncer-feeds
kubectl --context prod-us-east -n feeds get pods -l app=redis-feeds
kubectl --context prod-us-east -n feeds describe pod <pod-name>
```

In the pod description, look for the sidecar container status, readiness probe failures, or recent restarts. If the pod is Running but the exporter container is not Ready, this is usually the exporter process itself or its credentials.

3. Check the sidecar logs first. Password rotation is the usual cause.

```bash
kubectl --context prod-us-east -n feeds logs <pod-name> -c pgbouncer_exporter --since=30m
kubectl --context prod-us-east -n feeds logs <pod-name> -c redis_exporter --since=30m
```

Typical evidence is authentication failure, connection refused to the local socket or local endpoint, or a startup loop after the secret changed. If you see errors that line up with a recent secret rollout, treat that as the primary lead.

4. Verify whether the secret or config changed recently.

```bash
kubectl --context prod-us-east -n feeds get secret | grep -E 'pgbouncer|redis'
kubectl --context prod-us-east -n feeds get deploy,sts -o wide
kubectl --context prod-us-east -n feeds rollout history sts/pgbouncer-feeds
kubectl --context prod-us-east -n feeds rollout history sts/redis-feeds
```

If the exporter uses a rotated password and the pod has not picked it up cleanly, the sidecar usually keeps failing while the main service keeps serving. That is why this is a blind spot, not just a noisy alert.

5. Check whether the metrics endpoint is reachable from inside the pod.

```bash
kubectl --context prod-us-east -n feeds exec -it <pod-name> -c pgbouncer_exporter -- sh -lc 'wget -qO- http://127.0.0.1:9127/metrics | head'
kubectl --context prod-us-east -n feeds exec -it <pod-name> -c redis_exporter -- sh -lc 'wget -qO- http://127.0.0.1:9121/metrics | head'
```

If the sidecar is up but metrics are empty or the process hangs, compare that with the logs. If the pod cannot serve the endpoint locally, Prometheus will keep marking the target down.

## Mitigation

1. If the logs point to credential failure, verify the secret update and restart the affected workload so the sidecar rereads the current credentials.

```bash
kubectl --context prod-us-east -n feeds rollout restart sts/pgbouncer-feeds
kubectl --context prod-us-east -n feeds rollout restart sts/redis-feeds
```

2. If only one pod is affected, you can delete that pod to force a clean restart.

```bash
kubectl --context prod-us-east -n feeds delete pod <pod-name>
```

3. Watch the target and the downstream alerts after restart. If the exporter recovers, `TargetDown` should clear, and the missing visibility window should be short.

```bash
amtool alert query alertname=TargetDown
```

4. If the restart does not help, check the pod events for repeated probe failures or image pull issues, then escalate with the exact log line and pod name.

## Escalation

Page or hand off based on the service:

- `pgbouncer-feeds`, escalate to `feeds` and `mbe` if the exporter will not authenticate after a restart.
- `redis-feeds`, escalate to `platform` if the exporter remains down or the pod keeps restarting.

Include these details in `#oncall`, `#feeds-dev`, or `#platform` as appropriate:

- alert firing time
- pod name and namespace
- exporter container name
- last 20 lines of exporter logs
- whether the restart fixed it
- whether password rotation happened recently

If the issue affects multiple pods at once, open a ticket with the matching prefix, usually `FEED-` for feeds sidecars or `PLAT-` for platform-owned Redis work.

## What to look for in Grafana

Open the exporter dashboard and check the target state panel first. The useful screenshot is the one where the target is red, with the pod label visible and the scrape duration graph dropping flat. If the target is down but the main pod is healthy, that is the expected pattern for this class of issue. It means we are blind on the exporter metrics, not necessarily down on the service itself.

Useful links:

- Grafana, `https://grafana.castlane.internal/d/<dashboard>`
- Internal runbooks, `https://runbooks.castlane.internal`

## History

- 2025-09-30, version 1, initial runbook for `TargetDown` on `pgbouncer_exporter` and `redis_exporter` sidecars.
- 2025-09-30, version 1, added guidance to check sidecar logs first because password rotation is the usual cause.
- 2025-09-30, version 1, clarified that this alert creates a blind spot for `PgBouncerPoolSaturated` and Redis-related visibility.
