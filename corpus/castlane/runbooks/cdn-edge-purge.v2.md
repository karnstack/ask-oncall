---
id: runbooks/cdn-edge-purge.md@v2
source: runbooks
type: runbook
title: "Purging a feed or episode from cdn-edge"
url: https://runbooks.castlane.internal/cdn-edge-purge/v2
service: [cdn-edge]
allowed_groups: [eng, contractors]
author: bo
version: 2
effective_at: 2025-06-03
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-06-03T15:38:00Z
generated: true
---
# Purging a feed or episode from cdn-edge

This runbook covers cache purges on `cdn-edge` when a creator deletes or replaces an episode, or when a feed is serving stale XML. `cdn-edge` runs in the `edge` namespace and is owned by the edge team. Feed XML is cached for 60 seconds, audio for 30 days, so most fixes are a targeted purge rather than a config change.

## Diagnosis

1. Confirm whether the bad object is a feed or audio file, and whether the issue is stale cache or bad origin content.

```bash
kubectl --context prod-eu-west -n edge get pods -l app=cdn-edge
curl -sI https://cdn.castlane.example/shows/123/feed.xml
curl -sI https://cdn.castlane.example/audio/episode-456.mp3
```

Look at `Age`, `Cache-Control`, and any `X-Cache` style headers. A high `Age` with a correct origin usually means a purge will fix it. A wrong body at origin means purging will only refresh the wrong content faster.

2. Check whether the feed was recently rebuilt or the episode was replaced upstream.

```bash
kubectl --context prod-us-east -n feeds get pods -l app=feed-builder
kubectl --context prod-us-east -n media get pods -l app=upload-api
kubectl --context prod-us-east -n media logs deploy/upload-api --since=30m | grep -E 'episode|feed|replace|delete'
```

If the creator deleted or swapped an episode, expect the old audio URL or feed item to remain visible until cache expiry or purge.

3. Measure how widespread the stale object is before purging.

```bash
curl -s https://cdn.castlane.example/shows/123/feed.xml | sha256sum
curl -s https://cdn.castlane.example/shows/123/feed.xml | sed -n '1,12p'
```

If only one show is affected, prefer a surrogate-key purge. If multiple items in the same show are stale, purge the show key instead of individual URLs.

## Purge targets

| Situation | Recommended purge | Notes |
| --- | --- | --- |
| Single episode audio changed | Purge by URL | Audio is cached for 30 days, so stale files can linger a long time |
| Feed XML wrong for one show | `show:<show_id>` | This clears the show feed and related cached variants |
| Creator deleted an episode | URL purge for the episode, then show key if the feed still lists it | Purges usually propagate in about 20 seconds |
| Creator replaced an episode file | Purge the old audio URL and the feed URL | This avoids a mismatch between feed item and media file |

## Mitigation

1. Run the narrowest purge that fixes the visible problem.

```bash
edgectl purge --key show:123
```

For a single URL:

```bash
edgectl purge --url https://cdn.castlane.example/shows/123/feed.xml
edgectl purge --url https://cdn.castlane.example/audio/episode-456.mp3
```

2. Wait for propagation, then verify from the edge again.

```bash
sleep 20
curl -sI https://cdn.castlane.example/shows/123/feed.xml
curl -sI https://cdn.castlane.example/audio/episode-456.mp3
```

A successful purge should drop the cached object and return fresh headers on the next request. If the same object still serves stale content after about 20 seconds, retry once, then check whether you hit the purge rate limit.

3. Stay under the purge limit. `cdn-edge` allows 300 purges per minute, which is enough for normal incident response but easy to exceed during a bad bulk import.

```bash
edgectl purge --key show:123
edgectl purge --key show:124
edgectl purge --key show:125
```

If you need to purge many objects, batch them by show key where possible. Do not spray individual URL purges across a large back catalog unless there is no surrogate key coverage.

## Escalation

Escalate to the edge team in `#edge` if any of these happen:

- The purge returns an error repeatedly.
- Purges are accepted but the object is still stale after 60 seconds.
- You need a purge-all.
- You are at risk of crossing the 300 per minute limit.

Use `#incidents` or open an incident with `incident-bot` if user impact is ongoing.

```bash
/incident create "cdn-edge stale feed or episode after purge"
```

Purge-all needs explicit edge team approval, since it can create a burst of origin traffic and transient cache miss spikes. If approved, coordinate the timing and watch hit ratio recovery in Grafana after the purge completes.

## Verification

| Signal | Healthy after purge |
| --- | --- |
| Feed XML `Age` | Near zero on first refresh |
| Audio `Age` | Near zero on first refresh |
| Cache hit ratio | Returns toward baseline within a few minutes |
| User-visible content | Shows the deleted or replaced episode state |

If the feed still looks wrong but the edge is fresh, the origin may still be serving stale data. In that case the fix is in `feed-builder` or the upstream source, not `cdn-edge`.

## History

- 2025-05-14, version 1.0, added surrogate-key purge guidance for show-level feed issues and noted the 20 second propagation window.
- 2025-05-27, version 1.1, clarified audio versus feed TTLs, and added the purge rate limit of 300 per minute.
- 2025-06-03, version 2.0, tightened verification steps and added the purge-all escalation path for edge approval.
