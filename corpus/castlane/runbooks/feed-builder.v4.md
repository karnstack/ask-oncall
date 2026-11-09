---
id: runbooks/feed-builder.md@v4
source: runbooks
type: runbook
title: "feed-builder"
url: https://runbooks.castlane.internal/feed-builder/v4
service: [feed-builder, redis-feeds]
alerts: [FeedBuildLagHigh, KubeHpaMaxedOut]
allowed_groups: [eng, contractors]
author: zi
version: 4
effective_at: 2026-02-10
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-02-10T13:24:00Z
generated: true
---
# feed-builder

`feed-builder` lives in the `feeds` namespace and is owned by the feeds team. We use it to rebuild each show's RSS XML when an episode is published or edited, then we write the XML to object storage and let `cdn-edge` serve it. Work enters through the Redis queue `feed-rebuild`, so when this service slows down, creators see stale feeds and podcast apps keep polling old XML.

## Alerts that link here

- `FeedBuildLagHigh`
- `KubeHpaMaxedOut`

## Diagnosis

1. Check whether we are actually behind, and how far behind we are. We usually start with the lag metric and the queue depth together, because either one alone can mislead us.

```bash
kubectl --context prod-us-east -n feeds port-forward deploy/feed-builder 9090:9090
curl -s localhost:9090/metrics | grep '^feed_builder_lag_seconds'
redis-cli -h redis-feeds -n 0 LLEN feed-rebuild
```

If `feed_builder_lag_seconds` is above 300 for 10 minutes, the alert is valid. If the queue is empty but lag is still high, we usually have a stuck worker or a per-show lock.

2. Look for the common shape in the workload. A single show with thousands of episodes can dominate a worker and make the whole queue look unhealthy, especially right after a bulk edit or a backfill.

```bash
kubectl --context prod-us-east -n feeds get pods -l app=feed-builder
kubectl --context prod-us-east -n feeds logs deploy/feed-builder --since=30m | grep -E 'show_id=|rebuild'
```

We expect to see repeated rebuilds for one show if this is the cause. If one show is huge, the queue is healthy but slow, and we should avoid treating it like a general outage.

3. Check for a stuck lock. Each show uses a per-show lock key, and if the lock is left behind, that show will not rebuild until we clear it.

```bash
redis-cli -h redis-feeds -n 0 KEYS 'feedlock:*'
redis-cli -h redis-feeds -n 0 TTL feedlock:<show_id>
feed-builder-admin unlock <show_id>
```

If the lock key exists with a long TTL or no progress in logs, this is often the reason the rebuild is stalled. We only unlock after we confirm the show is not actively rebuilding.

4. Check the maintenance flag. We have been caught by this before, because `feeds.writes_paused` can stay true after a planned maintenance window and silently block new feed writes.

```bash
flagctl get feeds.writes_paused
```

If it returns `true`, that explains why the queue is draining slowly or not at all. We should confirm whether the flag was supposed to be turned back on.

5. Check whether the HPA is pinned at its limit. When `feed-builder` reaches 40 replicas, new load can still arrive faster than we can clear it, and the lag alert will stay active.

```bash
kubectl --context prod-us-east -n feeds get hpa feed-builder
kubectl --context prod-us-east -n feeds describe hpa feed-builder
kubectl --context prod-us-east -n feeds top pods
```

If current replicas are at 40 and CPU is still high, we are at the ceiling. If the queue is growing while the HPA is maxed, we need to reduce input or fix the slow path rather than waiting.

## Mitigation

If `feeds.writes_paused` is still true and maintenance is over, unset it first. That is the cleanest fix when the team simply forgot to restore writes.

```bash
flagctl set feeds.writes_paused false --reason "Restore feed writes after maintenance"
```

If a specific show is stuck, clear only that lock and watch the queue move again.

```bash
feed-builder-admin unlock <show_id>
```

If the HPA is at 40 and the queue keeps growing, we usually look for one of two things. Either one show is dominating the queue, in which case we let that backlog drain naturally, or the service has become CPU bound and needs more headroom from a safer code path, not from a blind restart.

If pods are unhealthy, restart only after we have checked locks and the flag. A restart without that check can make us lose context and stretch the lag longer.

```bash
kubectl --context prod-us-east -n feeds rollout restart deploy/feed-builder
kubectl --context prod-us-east -n feeds rollout status deploy/feed-builder
```

After mitigation, verify that lag drops and the queue begins to shrink. We want `feed_builder_lag_seconds` under 300 and trending down, not just a temporary dip.

## Escalation

If the lag remains high for more than 15 minutes after we have cleared obvious locks and confirmed the flag state, page the feeds owner in `#oncall`. If the issue is clearly tied to Redis availability or queue behavior, loop in `rs` or `zi` early so we can separate application slowness from infrastructure trouble.

For repeated HPA saturation with no single-show hotspot, escalate to `#platform` and include the current replica count, queue depth, and the last 30 minutes of logs. If object storage writes are failing, add `yu` because the XML output path from `feed-builder` to `cdn-edge` can fail in a way that looks like simple lag.

## Key paths

- Input queue, Redis list `feed-rebuild`
- Lock key pattern, `feedlock:<show_id>`
- Output path, object storage, then `cdn-edge`
- Primary metric, `feed_builder_lag_seconds`

## History

- 2026-01-18, version 2: we added the Redis lock check to the standard diagnosis because a single stuck `feedlock:<show_id>` had been masking a healthy queue drain.
- 2026-01-29, version 3: we clarified that `feeds.writes_paused` can block rebuilds after maintenance, and we started checking the flag before restarting pods.
- 2026-02-10, version 4: we documented the HPA ceiling at 40 and tied `FeedBuildLagHigh` directly to `feed_builder_lag_seconds > 300 for 10m`.
