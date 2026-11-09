---
id: adr/ADR-0029-two-regions.md
source: adr
type: adr
title: "ADR-0029: Serve feeds from two regions"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0029-two-regions.md
service: [feed-builder, cdn-edge, pgbouncer-feeds]
allowed_groups: [eng]
author: rs
version: 1
effective_at: 2025-07-22
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-07-22T13:20:00Z
generated: true
---
# ADR-0029: Serve feeds from two regions

Status: Accepted, Date 2025-07-22, Deciders: rs, tw, mbe

## Context

Castlane currently serves RSS feeds and private feed reads from prod-us-east only. That has been operationally simple, but it creates a single regional dependency for every podcast app request that needs a feed refresh or a private feed lookup.

We want lower latency for listeners and subscribers in Europe, and we want better failure isolation if one region has degraded network, Kubernetes issues, or a regional cloud provider problem. Writes must still stay in prod-us-east because that is where the feed mutation path, episode ingest path, and the canonical Postgres write cluster live.

We reviewed recent traffic and error patterns in the feed-serving dashboard, https://grafana.castlane.internal/d/feed-serving. The main signals were:
- feed latency is highest for EU clients when they reach us in the east region
- private feed reads are on the same request path as public feed reads
- read traffic can be served from a second region without changing write ownership

Key checklists:
- Keep one write region
- Add a second read region
- Keep private feed reads consistent with public feed reads
- Keep operational ownership clear for paging and rollback

Relevant PromQL used during planning:
```promql
histogram_quantile(0.95, sum by (le, region) (rate(http_request_duration_seconds_bucket{service="feed-builder"}[5m])))
```

```promql
sum by (region) (rate(http_requests_total{service=~"feed-builder|private-feeds",code=~"5.."}[5m]))
```

## Decision

We will serve feeds from both prod-us-east and prod-eu-west.

Concrete settings:
- feed-builder runs in both prod-us-east and prod-eu-west
- pgbouncer-feeds runs in both regions, one deployment per region
- feed-builder in prod-eu-west reads from the regional pgbouncer-feeds, but all writes remain routed to prod-us-east
- private-feeds reads from the local region when possible, but any state-changing workflow stays write-gated through prod-us-east
- cdn-edge routes feed requests by latency, not by a fixed region map
- alerting and paging are regional, so prod-us-east and prod-eu-west each have their own oncall route
- feed rebuild jobs still enqueue in the same logical queues, but workers in each region consume the workload local to that region

Operational settings:
- prod-us-east remains the source of truth for feed mutations
- prod-eu-west is read-serving only for feed content and private feed lookups
- both regions must be healthy before we treat feed serving as fully available

## Consequences

Good:
- lower latency for EU feed requests and private feed reads
- better resilience if one region has a partial outage
- cleaner rollback path, since the read plane can fail over without touching writes
- clearer ownership of regional capacity and paging

Bad:
- more moving parts, two feed-builder deployments and two pgbouncer-feeds deployments to watch
- risk of region skew if deployment versions drift
- more complicated debugging when one region is healthy and the other is not
- page routing must be explicit, or we will wake the wrong oncall

This decision adds two regional SLO views to the dashboard:
- one for request latency
- one for regional availability

Example alert checks:
```promql
sum by (region) (rate(alertmanager_notifications_total{alertname="FeedBuildLagHigh"}[10m]))
```

```promql
max_over_time(up{service="feed-builder"}[15m])
```

## Alternatives considered

1. Keep all feed serving in prod-us-east.  
   Why not: simplest operationally, but it leaves Europe on the long path and keeps one region as a hard dependency for all reads.

2. Put a global cache in front of the current feed path.  
   Why not: cache would help some repeat requests, but private feeds and rebuild freshness still need regional read serving and clear write ownership.

3. Make prod-eu-west active-active for writes too.  
   Why not: too much consistency risk for the feed mutation path, and it would require a larger redesign of write coordination across pgbouncer-feeds and feed-builder.
