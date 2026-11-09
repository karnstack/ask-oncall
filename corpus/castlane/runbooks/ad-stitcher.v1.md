---
id: runbooks/ad-stitcher.md@v1
source: runbooks
type: runbook
title: "ad-stitcher latency and the no-ads fallback"
url: https://runbooks.castlane.internal/ad-stitcher/v1
service: [ad-stitcher, cdn-edge]
allowed_groups: [eng, contractors]
author: pk
version: 1
effective_at: 2026-03-24
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-03-24T12:17:00Z
generated: true
---
# ad-stitcher latency and the no-ads fallback

`ad-stitcher` sits in the `edge` namespace and stitches ads into episode audio when a request comes in for a show that has ads enabled. It is owned by the edge team, and it works closely with `cdn-edge`, which will serve the unstitched file if stitching does not complete within 1.5 seconds. The latency target is p99 400 ms to first byte, so once we miss that budget, the user experience usually degrades into a no-ads fallback.

## Diagnosis

1. Check whether this is a broad latency issue or only affecting specific shows.

```bash
kubectl --context prod-us-east -n edge get pods -l app=ad-stitcher
kubectl --context prod-us-east -n edge logs deploy/ad-stitcher --since=15m | tail -n 200
```

Look for slow upstream fetches, repeated retries, or request timeouts. If most requests are completing but some are falling back, the problem is often show-specific.

2. Confirm whether the global stitching flag is off.

```bash
flagctl get ads.stitching_enabled
```

If it is `false`, `ad-stitcher` is effectively disabled for everyone. In that case, `cdn-edge` will keep serving unstitched audio after the fallback window.

3. Check whether a specific show is disabled.

```bash
flagctl get ads.show.<show_id>
```

Replace `<show_id>` with the affected show. If this flag is `false`, only that show is bypassing ads stitching.

4. Compare live request timing with the budget.

```bash
curl -sS -o /dev/null \
  -w 'dns=%{time_namelookup} connect=%{time_connect} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  'https://cdn.castlane.example/episodes/<episode_id>.mp3?show_id=<show_id>'
```

If `time_starttransfer` is consistently above `1.5` seconds, `cdn-edge` will likely return the unstitched asset. If it is between `400 ms` and `1.5 s`, users may still hear ads intermittently, but the service is missing its SLO.

5. Check for pod-level problems on the edge path.

```bash
kubectl --context prod-us-east -n edge get deploy,po
kubectl --context prod-us-east -n edge describe deploy/ad-stitcher
kubectl --context prod-us-east -n edge get events --sort-by=.lastTimestamp | tail -n 20
```

Pay attention to `KubePodNotReady`, `KubePodCrashLooping`, `KubeDeploymentReplicasMismatch`, or `CPUThrottlingHigh`. Any of these can push first byte beyond the fallback threshold.

6. If you need a quick signal from metrics, open the service dashboard and look at p99 latency and error rate.

```bash
echo "Open https://grafana.castlane.internal/d/<dashboard> and inspect ad-stitcher p99 latency, request rate, and upstream error rate"
```

A sudden p99 climb with stable traffic usually points to dependency slowness or pod resource pressure. A request drop with healthy latency often means the flag was changed.

## Mitigation

1. If the issue is isolated to one show, disable stitching for that show only.

```bash
flagctl set ads.show.<show_id> false --reason "ad-stitcher latency causing fallback for this show"
```

Tell `#media` right away, since creators lose ad revenue while the show is off stitching.

2. If the issue is broad and user impact is rising, turn off stitching globally.

```bash
flagctl set ads.stitching_enabled false --reason "protect playback while ad-stitcher latency exceeds fallback budget"
```

This is the fastest safe mitigation. It increases no-ads playback but avoids repeated slow starts and partial ad loads.

3. If pods are unhealthy, restart the deployment after confirming no config change is in flight.

```bash
kubectl --context prod-us-east -n edge rollout restart deploy/ad-stitcher
kubectl --context prod-us-east -n edge rollout status deploy/ad-stitcher
```

4. If the issue is a bad build or a rollout regression, revert it.

```bash
/ deploy rollback ad-stitcher
```

If rollback is not available in the current Slack channel, use the last known good image through the deployment manifest path that the edge team uses.

5. Once latency is back under the target, re-enable stitching in a controlled way.

```bash
flagctl set ads.stitching_enabled true --reason "latency recovered, re-enabling ads stitching"
```

Then restore any per-show flags only after checking the affected shows in `#media`.

## Escalation

- Page the edge oncall in `#oncall` if p99 stays above 400 ms for more than 10 minutes or fallback rate keeps climbing.
- If the issue appears tied to a single show list or a flag mistake, coordinate in `#media` and note which shows were affected.
- If you see cluster-wide pod failures, node issues, or certificate problems, escalate through the standard kube path and attach the relevant pod descriptions and logs.
- If the service is healthy but request timing is still bad, open a ticket with the request samples, timestamps, and the exact flag state. Use `EDGE-` for service issues and `PLAT-` only if the flag tooling itself is broken.

## Settings

| Setting | Scope | Effect |
| --- | --- | --- |
| `ads.stitching_enabled` | Global | Turns stitching off for everyone |
| `ads.show.<show_id>` | Per show | Turns stitching off for one show |

## History

- 2026-03-24, version 1. Initial runbook for ad-stitcher latency and the no-ads fallback.
- 2026-03-24, version 1. Documented global and per-show flag behavior, plus the `#media` notification requirement.
- 2026-03-24, version 1. Added fallback timing guidance for `cdn-edge` serving unstitched audio after 1.5 seconds.
