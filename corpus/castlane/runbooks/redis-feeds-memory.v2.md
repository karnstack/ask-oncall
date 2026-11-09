---
id: runbooks/redis-feeds-memory.md@v2
source: runbooks
type: runbook
title: "redis-feeds memory and evictions"
url: https://runbooks.castlane.internal/redis-feeds-memory/v2
service: [redis-feeds]
allowed_groups: [eng, contractors]
author: gf
version: 2
effective_at: 2025-05-06
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-05-06T11:06:00Z
generated: true
---
# redis-feeds memory and evictions

`redis-feeds` is the Redis instance in `feeds` that holds the `transcode` and `feed-rebuild` queues, plus a small cache used by feed-serving jobs. It runs in the `feeds` namespace and is owned by the feeds team. The configuration is intentional: `maxmemory` is 12gb and `maxmemory-policy` is `noeviction`, because losing queue jobs is a bad hobby.

## Diagnosis

1. Check whether memory is actually the problem, or whether someone just panicked at a graph.

```bash
kubectl -n feeds get pods -l app=redis-feeds
redis-cli -h redis-feeds.redis-feeds.svc.cluster.local INFO memory | egrep 'used_memory_human|used_memory_peak_human|maxmemory_human|mem_fragmentation_ratio'
```

If `used_memory` is above 85 percent of `maxmemory`, treat it as real. Redis is not trying to be dramatic, it is trying to tell you it is full.

2. Confirm whether the queues are growing. We care about the two lists, not the decorative cache.

```bash
redis-cli -h redis-feeds.redis-feeds.svc.cluster.local LLEN transcode
redis-cli -h redis-feeds.redis-feeds.svc.cluster.local LLEN feed-rebuild
```

If either queue is climbing and memory is rising, the problem is likely upstream capacity or a stalled worker pool, not Redis itself.

3. Find the biggest keys. This is the fastest way to learn what is eating the box without guessing.

```bash
redis-cli -h redis-feeds.redis-feeds.svc.cluster.local --bigkeys
```

Pay attention to large lists and unexpectedly large hashes or strings. If a cache key has gone feral, note its name and TTL, if any.

4. Check whether Redis is rejecting writes. With `noeviction`, Redis should fail writes rather than discard data. That is the whole point.

```bash
redis-cli -h redis-feeds.redis-feeds.svc.cluster.local INFO stats | egrep 'rejected_connections|evicted_keys'
```

`evicted_keys` should stay at zero. If it is not zero, the configuration is not doing what it says on the tin, which is always exciting in the worst way.

5. Look for pressure on the Redis pods themselves.

```bash
kubectl -n feeds describe pod -l app=redis-feeds | sed -n '/Events:/,$p'
kubectl -n feeds top pod -l app=redis-feeds
```

A pod that is being throttled or restarted will make memory symptoms noisier and more annoying.

## Mitigation

If memory is over 85 percent and rising, do the least glamorous thing first, reduce demand.

1. Check whether a backlog is being driven by a downstream outage or worker shortage. If `transcode` or `feed-rebuild` is climbing, that usually means the workers need help.

2. If the issue is a cache key that is too large or too hot, shorten its TTL in the service that writes it, or remove that key from the cache path. Do not delete keys by hand unless you know exactly what they do.

3. If queue growth is the cause, scale the consumers before touching Redis.

```bash
kubectl -n media get deploy transcoder transcoder-slow
kubectl -n feeds get deploy feed-builder
```

4. If you need to clear a harmless cache key and only a cache key, do that surgically. If you are about to type `FLUSHALL`, close your shell and take a walk.

```bash
redis-cli -h redis-feeds.redis-feeds.svc.cluster.local DEL some-cache-key
```

5. If the pod is close to the memory limit but not yet failing, restart only after the root cause is understood. A restart is not a fix, it is a reset button with a calendar invite.

## Settings

| Setting | Value | Notes |
| --- | --- | --- |
| `maxmemory` | 12gb | Hard cap |
| `maxmemory-policy` | `noeviction` | Do not drop queue jobs |
| Main queues | `transcode`, `feed-rebuild` | Protect these first |
| Cache | Small | Should stay small. That is the assignment |

## Escalation

Escalate to `zi` or `ok` for feed queue growth, and to `ext-rb` if the Redis pod itself is unhealthy or needs cluster-level triage. If the issue is tied to a deployment in `media` or a bad cache write path, include the relevant service and the `--bigkeys` output in the handoff.

If eviction-like behaviour is observed, or writes are failing while memory is still below the limit, open a `FEED-` ticket and page `mbe` as well. Include:

- current memory usage
- `LLEN transcode`
- `LLEN feed-rebuild`
- `redis-cli --bigkeys` output
- any pod events from `kubectl describe`

## History

- 2025-02-14, version 1: Initial runbook for Redis memory pressure on `redis-feeds`. Focused on queue preservation and cache hygiene.
- 2025-04-03, version 2: Added queue length checks, clarified `noeviction` behaviour, and made `FLUSHALL` explicitly forbidden.
- 2025-05-06, version 2: Updated for the current 12gb memory cap and the 85 percent action threshold.
