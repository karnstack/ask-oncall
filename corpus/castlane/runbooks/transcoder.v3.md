---
id: runbooks/transcoder.md@v3
source: runbooks
type: runbook
title: transcoder
url: https://runbooks.castlane.internal/transcoder/v3
service: [transcoder, upload-api]
alerts: [KubePodCrashLooping, TranscodeQueueBacklog, KubeHpaMaxedOut]
allowed_groups: [eng, contractors]
author: pk
version: 3
effective_at: 2025-10-02
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-03-19T10:44:00Z
---

# transcoder

Queue workers that turn uploaded audio into the files we serve: MP3 at
64 and 128 kbps plus the loudness-normalised master. Namespace `media`,
deployment `transcoder`, 10 to 30 pods (HPA on queue depth). Jobs come from
the `transcode` queue in Redis, written by upload-api. Owner: media team.

## Alerts that link here

- `KubePodCrashLooping` with `container=transcoder`
- `TranscodeQueueBacklog`: `transcoder_queue_depth > 500 for 15m`
- `KubeHpaMaxedOut` for `transcoder`

## Settings that matter

| Setting | Value | Where |
|---|---|---|
| memory request / limit | 2Gi / 3Gi | deployment `transcoder` |
| `TRANSCODE_MAX_PARALLEL` | 2 | env, ConfigMap `transcoder-config` |
| `TRANSCODE_MAX_INPUT_HOURS` | 8 | env, ConfigMap `transcoder-config` |
| HPA min / max | 10 / 30 | `hpa/transcoder` |

The memory limit and `TRANSCODE_MAX_PARALLEL` go together. One ffmpeg job
on a long uncompressed upload can use 1.2 GiB while it resamples. Two jobs
fit in 3Gi. Do not raise the limit to make crash loops go away; lower the
parallelism instead (MEDIA-812).

## KubePodCrashLooping

1. Why is it restarting?

   ```
   kubectl -n media get pods -l app=transcoder
   kubectl -n media describe pod <pod> | grep -A5 "Last State"
   ```

2. `Reason: OOMKilled`, exit code 137: a job used more memory than the pod
   has. Find the upload:

   ```
   kubectl -n media logs <pod> --previous | grep -E "job_id|input_duration|sample_rate" | tail -5
   ```

   Usually a very long WAV or a 96 kHz upload. Set `TRANSCODE_MAX_PARALLEL`
   to 1 for the deployment until the job finishes:

   ```
   kubectl -n media set env deploy/transcoder TRANSCODE_MAX_PARALLEL=1
   ```

   Put it back to 2 afterwards. If the same upload kills pods again, move
   it to the slow lane: `transcoder-admin requeue <job_id> --lane slow`
   (one job at a time on 6Gi pods, deployment `transcoder-slow`).
3. Exit code 1 with `cannot connect to redis`: Redis is the problem, not the
   transcoder. See the Redis runbook.
4. Exit code 1 with `config: missing TRANSCODE_` : someone edited
   `transcoder-config`. Roll it back from git, do not hand-fix it.
5. Anything else: the generic steps in the KubePodCrashLooping runbook
   (events, previous logs, probes).

## TranscodeQueueBacklog

Check the HPA first (`kubectl -n media get hpa transcoder`). If it is at 30
and the queue still grows, it is a real surge (a big network moved shows to
us, or many creators uploaded at once). Tell `#media`; raising the HPA max
needs node capacity, ask platform. If pods are crash looping, fix that first,
the backlog will follow.

## History

- v3 (2025-10-02): limit 3Gi with `TRANSCODE_MAX_PARALLEL=2`, replacing the
  4Gi bump from INC-1987. Slow lane added.
- v2 (2024-12): HPA on queue depth.
- v1 (2023): from the wiki page.
