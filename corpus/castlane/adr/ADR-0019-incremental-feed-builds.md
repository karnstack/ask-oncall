---
id: adr/ADR-0019-incremental-feed-builds.md
source: adr
type: adr
title: "ADR-0019: Incremental feed builds"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0019-incremental-feed-builds.md
service: [feed-builder]
allowed_groups: [eng]
author: zi
version: 1
effective_at: 2024-05-14
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2024-05-14T09:44:00Z
generated: true
---
# ADR-0019: Incremental feed builds

Status: Accepted, Date 2024-05-14, Deciders: zi, tw, ok

## Context

We have been rebuilding entire podcast feeds every time something changed, and that worked fine when most shows were small. As Castlane grew, we started seeing a different pattern. A few large shows account for most feed rebuild work, and each rebuild asks feed-builder to re-read all items, regenerate the full XML, and write the whole document back out. For those shows, even a small metadata edit or a new episode can trigger a long rebuild, which adds latency for creators and puts unnecessary pressure on the feed-serving path.

We also found that the same feeds are requested often by podcast apps, so a slow rebuild does not stay isolated to the background job. When the rebuild queue grows, we delay updates that creators expect to see quickly, and we end up with more churn in the cache layer than we want. We do not want to move to a model where every update waits on a full serialization of the entire show if only one or two items changed.

We looked at the shape of the data and found that most feed changes are local. An episode title changes, an enclosure URL changes, a publish date is corrected, or a new episode is appended. Those are all cases where the feed body mostly stays the same. We already keep the latest XML in cache, so the remaining question was whether we could update only the changed parts without making the system fragile.

## Decision

We will implement incremental feed builds in feed-builder.

When an update comes in, feed-builder will identify the changed items and rebuild only those episode entries. It will then splice the updated XML fragments into the cached full feed document instead of serializing the entire feed from scratch. We will keep the cached feed as the source for unchanged items during the incremental path.

We will keep a full rebuild job for every show on a nightly schedule, and that job will regenerate the complete XML from canonical data, then replace the cached document. This gives us a periodic consistency check and a clean recovery path if an incremental update ever drifts.

Concretely, we will:
- use the incremental path for episode additions, metadata edits, and enclosure updates
- keep the nightly full rebuild per show as the authoritative refresh
- treat the full rebuild as the fallback any time the cached document is missing, stale, or structurally incompatible with the incremental update
- log incremental and full rebuild outcomes separately so we can compare latency and failure rates

## Consequences

The main benefit is lower rebuild latency for large shows. We expect the common case to be much faster because we are no longer paying the cost of regenerating every item on every change. That also reduces load on feed-builder during busy periods, and it should make updates feel more immediate for creators and for downstream podcast apps.

The nightly full rebuild gives us a safety net. If an incremental path misses something, the next full rebuild corrects it without manual intervention. This also gives us a simple way to validate that the incremental logic still produces the same feed structure as the canonical rebuild.

The downside is complexity. We now have two code paths, and we have to keep them consistent. That means more test coverage, more careful review when feed formats change, and more attention to edge cases like item reordering or changes that affect feed-level metadata. We are accepting that cost because the performance win is concentrated where we need it most.

## Alternatives considered

1. **Keep rebuilding the whole feed on every change**  
   We considered staying with the current approach because it is simple and easy to reason about. We rejected it because the slow path is already hurting large shows, and the cost will only grow as catalogs get bigger.

2. **Switch to incremental builds only, with no nightly full rebuild**  
   This would minimize work on each update, but we would lose the periodic full refresh that catches drift and repairs any partial corruption. We did not want to rely entirely on the incremental path without a regular reset.

3. **Move feed generation to a separate cache refresh service**  
   This could isolate the cache management from feed-builder, but it would spread ownership across more components and add another place where feed consistency could break. We preferred to keep the logic inside feed-builder so the rebuild rules stay in one service.
