---
id: runbooks/cdn-edge-origin-errors.md@v3
source: runbooks
type: runbook
title: "cdn-edge origin errors"
url: https://runbooks.castlane.internal/cdn-edge-origin-errors/v3
service: [cdn-edge, feed-builder]
alerts: [TargetDown]
allowed_groups: [eng, contractors]
author: yu
version: 3
effective_at: 2025-11-18
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-11-18T15:34:00Z
generated: true
---
# cdn-edge origin errors

This runbook covers 5xx responses returned by an origin and observed at the CDN edge in `cdn-edge` in the `edge` namespace. The owner team is `edge`, with `feed-builder` as the most common upstream dependency when the origin is feed XML or private feeds. Most listener traffic is shielded by `stale-if-error`, so cached feeds can keep serving for up to 24 hours and the impact is often lower than the raw edge error rate suggests.

## Alerts that link here

- `TargetDown`

## Diagnosis

1. Confirm the alert and open the edge origin dashboard.

```bash
# Open in Grafana
echo "https://grafana.castlane.internal/d/edge-origin"
```

Look for a spike in origin 5xx, broken down by origin host and response class. In the screenshot you want to see the panel titled `Origin response codes` and the time series for `5xx` rising first for one origin, not all of them at once.

2. Identify which origin is failing. There are three common ones:
   - Feed XML, stored in the `feeds-xml` object storage bucket
   - Audio files, stored in the `audio-mp3` bucket
   - `private-feeds`, the private feed service

```bash
kubectl -n edge get deploy cdn-edge
kubectl -n edge logs deploy/cdn-edge --since=30m | grep -E 'origin|5xx|upstream'
```

If the logs mention feed paths like `.xml`, `.rss`, or `feeds-xml`, you are likely dealing with feed XML. If they mention `.mp3`, media ranges, or `audio-mp3`, it is audio. If the logs show private feed URLs or auth token validation, check `private-feeds`.

3. Check whether the origin itself is healthy.

For `private-feeds`:

```bash
kubectl -n feeds get deploy private-feeds
kubectl -n feeds get pods -l app=private-feeds
kubectl -n feeds logs deploy/private-feeds --since=30m
```

For feed XML served from object storage, verify that `feed-builder` is producing current files and that the serving path has not regressed:

```bash
kubectl -n feeds get deploy feed-builder
kubectl -n feeds logs deploy/feed-builder --since=30m | tail -n 200
```

For audio, confirm the object key path and whether the origin fetches are failing only for a subset of files.

```bash
kubectl -n edge logs deploy/cdn-edge --since=30m | grep audio-mp3 | tail -n 50
```

4. Check if the issue is origin specific or edge wide.

```bash
kubectl -n edge get pods
kubectl -n edge describe pod -l app=cdn-edge | sed -n '1,220p'
```

If all edges are reporting the same origin 5xx, suspect the origin. If only one or two edge pods are affected, check node health and pod restarts first. The dashboard usually makes this clear, the graph will show either one origin line or a broad step up across all origins.

5. Determine whether cached content is masking the problem.

`stale-if-error` can keep feeds serving for up to 24 hours, so listeners may not notice even when origin fetches are failing. Check whether the failing requests are mostly misses or revalidations.

```bash
kubectl -n edge logs deploy/cdn-edge --since=30m | grep -E 'stale-if-error|cache miss|revalidate|origin 5xx' | tail -n 100
```

If the error rate is high but cache hit rate remains healthy, this is usually less urgent than a full outage.

## Mitigation

1. If the origin is `private-feeds`, page `feed-builder` only if the failure is clearly in feed generation or auth-signed response generation. Otherwise, page `edge` first and keep it within the team.

2. If feed XML is failing and `feed-builder` is behind, restart the builder only after checking for a backlog or a bad deploy. Do not guess.

```bash
kubectl -n feeds rollout status deploy/feed-builder
kubectl -n feeds get pods -l app=feed-builder
```

3. If audio origin errors are isolated to a small number of objects, purge the affected paths after confirming the object exists.

```bash
edgectl purge /audio/show/1234/episode/5678.mp3
```

4. If the origin is broadly unhealthy and the error rate is climbing, keep the CDN serving stale content while the origin recovers. Do not disable `stale-if-error` during the incident.

5. If you need to rollback a recent edge change, use deploy bot.

```text
/deploy rollback cdn-edge
```

## Escalation

Page the `edge` oncall when any of these are true:

- `TargetDown` stays active for more than 10 minutes and the failing origin is not recovering
- Origin 5xx affects more than one origin type, for example feed XML and audio at the same time
- `private-feeds` is returning 5xx to authenticated requests, since those failures can break paid subscriber access
- The dashboard shows customer-visible impact and stale cache is not covering the affected paths
- You have already verified the origin and need help from `feed-builder` or the platform team

If the issue is clearly in `feed-builder`, page `feeds` too. If it is in object storage access or DNS-like routing at the edge, keep `edge` in the lead and ask `platform` for a second look if needed.

## History

- 2025-09-03, version 1, first cut for origin 5xx triage at the edge.
- 2025-10-21, version 2, added private-feeds checks and stale-if-error guidance.
- 2025-11-18, version 3, clarified the dashboard flow and when to page `feed-builder` versus `edge`.
