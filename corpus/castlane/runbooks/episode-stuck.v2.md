---
id: runbooks/episode-stuck.md@v2
source: runbooks
type: runbook
title: "Episodes stuck in processing"
url: https://runbooks.castlane.internal/episode-stuck/v2
service: [upload-api, transcoder, feed-builder]
allowed_groups: [eng, contractors]
author: tw
version: 2
effective_at: 2026-04-21
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-04-21T14:31:00Z
generated: true
---
# Episodes stuck in processing

this runbook covers episodes that stay in `processing` in the creator dashboard even though the upload finished. the pipeline crosses `upload-api` in `media`, `transcoder` in `media`, and `feed-builder` in `feeds`. ownership is split between the media team and feeds team, but the first responder should use this flow and `episodes-admin` to identify the blocked step.

## Diagnosis

1. check the episode state end to end.

```bash
episodes-admin status <episode_id>
```

look for the three checkpoints:

- upload complete
- transcode job done
- feed rebuilt

if the output already shows all three complete, the dashboard may just be stale, move to mitigation and verify a feed rebuild happened recently.

2. confirm the upload finished in `upload-api`.

```bash
kubectl -n media get pod
kubectl -n media logs deploy/upload-api --since=2h | grep -F "<episode_id>"
```

you want to see a successful upload completion event and no retry loop for the same episode. if upload completion is missing, the episode is not ready for downstream work and the issue is upstream of this runbook.

3. inspect the transcode job.

```bash
transcoder-admin job <job_id>
```

check for status, last update time, and whether the job is marked done. if the job is stuck in a retryable state, look at the transcoder queue and pod health.

```bash
kubectl -n media get pods -l app=transcoder
kubectl -n media logs deploy/transcoder --since=2h | grep -F "<job_id>"
```

4. check feed rebuild lag.

```bash
kubectl -n feeds logs deploy/feed-builder --since=2h | grep -F "<episode_id>"
```

if the episode transcode is done but `feed-builder` has not rebuilt the feed, the delay is in the feeds side. if the feed builder is behind for many episodes, verify it is running and not crash looping.

```bash
kubectl -n feeds get pods -l app=feed-builder
kubectl -n feeds get deploy feed-builder
```

5. verify the episode status again after any action.

```bash
episodes-admin status <episode_id>
```

## Mitigation

- if the transcode job is stuck and safe to retry, requeue it.

```bash
transcoder-admin requeue <job_id>
```

- if `feed-builder` is lagging but healthy, wait for it to catch up after the transcode completes. do not manually edit episode state.
- if the dashboard still shows `processing` after `episodes-admin status` reports upload complete, transcode done, and feed rebuilt, force a fresh read from the creator app by rechecking after a few minutes. the state may be cached briefly.
- if a pod is unhealthy, restart is acceptable only when the job or queue state is already known and the restart will not duplicate work.

```bash
kubectl -n media rollout restart deploy/transcoder
kubectl -n feeds rollout restart deploy/feed-builder
```

use this only after checking logs, not as a first move.

## Escalation

- page `media` if upload completion is missing or if `transcoder-admin job <job_id>` shows repeated failures after one requeue.
- page `feeds` if the transcode is done and the feed is still not rebuilt after the normal lag window.
- page `platform` only if `episodes-admin status <episode_id>` is inconsistent with both service logs and the creator dashboard.
- if the issue affects many episodes at once, file a ticket in `MEDIA-` or `FEED-` depending on the first missing step and include:
  - episode id
  - job id
  - `episodes-admin status` output
  - relevant log lines
  - time of first failure

## Settings

| checkpoint | source | expected sign |
|---|---|---|
| upload complete | `upload-api` | episode no longer waiting on upload work |
| transcode job done | `transcoder-admin job <job_id>` | job status is complete |
| feed rebuilt | `feed-builder` | episode appears in the rebuilt feed and dashboard clears |

## History

- 2026-02-10, version 1, added the three-step pipeline check and the transcode requeue path.
- 2026-03-18, version 1.1, clarified that `episodes-admin status` is the primary view for diagnosis.
- 2026-04-21, version 2, tightened the mitigation order and added feed-builder lag checks.
