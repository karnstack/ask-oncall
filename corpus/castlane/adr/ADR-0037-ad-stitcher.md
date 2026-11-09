---
id: adr/ADR-0037-ad-stitcher.md
source: adr
type: adr
title: "ADR-0037: Dynamic ad insertion with ad-stitcher"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0037-ad-stitcher.md
service: [ad-stitcher, cdn-edge]
allowed_groups: [eng]
author: pk
version: 1
effective_at: 2026-01-27
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-01-27T13:20:00Z
generated: true
---
# ADR-0037: Dynamic ad insertion with ad-stitcher

Status: Accepted, Date 2026-01-27, Deciders: pk, yu, tw

## Context

Creators asked for ads to be inserted at play time instead of baked into the episode file. The main driver was that baked ads go stale too quickly, especially when a campaign changes mid-week or a creator wants different ads for different markets.

We already serve episode audio through `cdn-edge`, and we already have `ad-stitcher` in the edge path. The missing piece was making ad insertion happen on request, without forcing a full file rewrite or a new upload flow.

The constraints were tight:

- keep the request path under 400 ms for the common case,
- cache results per ad decision,
- fail open to the unstitched file after 1.5 s,
- do not add extra work to the transcoding queue.

## Decision

We will stitch ads at request time in `ad-stitcher`, behind `cdn-edge`.

`cdn-edge` continues to serve the canonical episode manifest and audio objects. When the request requires an ad decision, it calls `ad-stitcher` with:

```text
episode_id
show_id
region
device_class
request_time_bucket
```

`ad-stitcher` resolves the ad decision and builds a stitched response from pre-transcoded ad segments plus the already transcoded episode segments. It does not transcode audio on the hot path.

We cache the stitched output at the edge using a cache key that includes the ad decision hash:

```text
cache_key = episode_id + decision_hash + segment_range
```

The decision hash includes the selected ad creative, locale, and any pacing rule that affects segment choice. If the same decision is requested again, `cdn-edge` serves the cached stitched object directly.

Timeout and fallback:

```text
ad_stitch_timeout_ms = 400
ad_stitch_hard_deadline_ms = 1500
fallback_mode = unstitched
```

If `ad-stitcher` cannot return a stitched response within 400 ms, `cdn-edge` retries once with a short jittered backoff. If the full request exceeds 1.5 s, `cdn-edge` serves the unstitched file and logs the fallback path.

We keep the feature gated behind `ads.stitching_enabled`. Rollout is per show using `ads.show.<show_id>`.

Operationally:

```bash
flagctl set ads.stitching_enabled false --reason "default off during rollout"
flagctl set ads.show.48321 true --reason "pilot show for dynamic insertion"
```

## Consequences

Good:

- Ads can change without rebuilding the whole episode file.
- Campaign swaps are faster and cheaper.
- `cdn-edge` can cache the final stitched result, so repeated plays stay fast.
- We avoid pushing more work into the transcode queue.

Bad:

- The request path is more complex, especially around cache invalidation.
- A bad ad decision can affect many plays until the cache expires or is purged.
- There is a new dependency between `cdn-edge` and `ad-stitcher`, so edge latency now affects playback more directly.
- Fallback to unstitched audio means some listeners will not hear ads on slow paths, which changes fill rate.

## Alternatives considered

1. Bake ads into the uploaded file during transcode.  
   Why not: this makes ad changes expensive and slow, and it ties ad operations to the media pipeline.

2. Serve ads as separate sidecar tracks and let podcast apps stitch them.  
   Why not: too much client variance, and we do not control the playback behavior of podcast apps.

3. Redirect ad requests to a separate origin and keep `cdn-edge` dumb.  
   Why not: this adds extra network hops and removes the edge cache benefit, which makes the 400 ms target harder to hit.
