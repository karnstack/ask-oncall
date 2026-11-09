---
id: runbooks/transcoder-slow-lane.md@v1
source: runbooks
type: runbook
title: "transcoder slow lane"
url: https://runbooks.castlane.internal/transcoder-slow-lane/v1
service: [transcoder]
alerts: [TranscodeQueueBacklog]
allowed_groups: [eng, contractors]
author: vi
version: 1
effective_at: 2025-10-02
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-10-02T13:20:00Z
generated: true
---
# transcoder slow lane

`transcoder-slow` is the slow-path deployment for exceptionally long episodes and high sample-rate uploads. It runs in `media`, owned by the media team, and is separate from the normal `transcoder` deployment so long jobs do not crowd out the fast lane. Use it only when a job is too large or too expensive for the default path.

## Alerts that link here

- `TranscodeQueueBacklog`

## Diagnosis

1. Check whether the slow lane is actually backlogged.

```bash
kubectl --context prod-us-east -n media get deploy transcoder-slow
kubectl --context prod-us-east -n media get pods -l app=transcoder-slow
kubectl --context prod-us-east -n media top pods -l app=transcoder-slow
```

Look for one ready pod only, or for the pod to be restarting. The slow lane is intended to run one job at a time on a 6Gi pod.

2. Check the slow lane queue depth and compare it with the alert.

```bash
kubectl --context prod-us-east -n media exec deploy/transcoder-slow -- sh -c '
  curl -s http://localhost:9090/metrics | grep "^transcoder_queue_depth{lane=\"slow\"}"
'
```

If the metric is rising while the pod is healthy, the queue is blocked, not crashed.

3. Inspect which jobs are waiting.

```bash
transcoder-admin lanes
```

Look for jobs in `slow`, and note any job IDs stuck at the front of the lane. If the same job has been waiting for a long time, it is usually a large file, a high sample-rate source, or a bad input that needs requeueing.

4. Confirm the normal transcoder is healthy and not the real bottleneck.

```bash
kubectl --context prod-us-east -n media get deploy transcoder
kubectl --context prod-us-east -n media get pods -l app=transcoder
kubectl --context prod-us-east -n media exec deploy/transcoder -- sh -c '
  echo "TRANSCODE_MAX_PARALLEL=${TRANSCODE_MAX_PARALLEL}"
'
```

Normal transcoder pods should be on 3Gi limits and `TRANSCODE_MAX_PARALLEL=2`. If the fast lane is unhealthy, the backlog may be wider than the slow lane alone.

5. Check for node or pod pressure on the slow lane pod.

```bash
kubectl --context prod-us-east -n media describe pod -l app=transcoder-slow | sed -n '1,220p'
kubectl --context prod-us-east get events --sort-by=.lastTimestamp | tail -n 30
```

Look for `KubePodNotReady`, `KubePodCrashLooping`, `KubeContainerWaiting`, or node pressure messages. If the pod is repeatedly evicted or failing to start, the lane cannot drain.

## Mitigation

1. If one job is blocking the lane, move it back through the slow queue.

```bash
transcoder-admin requeue <job_id> --lane slow
```

Use this when a job needs a fresh attempt, for example after a transient decode failure or a bad worker state. Do not move it to the fast lane unless the file is known to be ordinary size and bitrate.

2. If the slow lane pod is unhealthy, restart the deployment.

```bash
kubectl --context prod-us-east -n media rollout restart deploy/transcoder-slow
kubectl --context prod-us-east -n media rollout status deploy/transcoder-slow --timeout=5m
```

After restart, re-check the queue depth metric and `transcoder-admin lanes`.

3. If the queue is still growing and the slow lane is healthy, reduce intake from the source system only as a last resort.

```bash
kubectl --context prod-us-east -n media scale deploy/transcoder --replicas=1
```

This does not change the slow lane. It only lowers fast-lane throughput to keep the cluster stable if node pressure is building.

4. If a bad release is suspected, roll back the transcoder deployment.

```bash
/deploy rollback transcoder
```

Use this only if both lanes are degraded or the same failure is hitting every new job.

## Escalation

Page `#media` first, then `#oncall` if the backlog is still rising after mitigation. Include the current `transcoder_queue_depth{lane="slow"}` value, the blocked `job_id`, and whether `transcoder-slow` is healthy.

Escalate to `mbe` if the failure looks like storage, worker scheduling, or repeated job decode errors that survive a pod restart. Escalate to `vi` if you need a second pair of eyes on lane routing or the job shape looks abnormal. If the alert includes pod failures or node pressure, loop in `ext-rb` or `ext-ml` only after the basic restart and requeue steps.

If the queue remains stuck for more than 20 minutes, open a `MEDIA-` ticket and link the alert and the `transcoder-admin lanes` output.

## Settings

| Item | Value |
| --- | --- |
| Slow lane deployment | `transcoder-slow` |
| Namespace | `media` |
| Pod memory target | 6Gi |
| Jobs per pod | 1 |
| Requeue command | `transcoder-admin requeue <job_id> --lane slow` |
| Lane list command | `transcoder-admin lanes` |
| Queue metric | `transcoder_queue_depth{lane="slow"}` |
| Normal transcoder memory target | 3Gi |
| Normal transcoder parallelism | `TRANSCODE_MAX_PARALLEL=2` |

## History

- 2025-09-11, added slow lane routing for very long episodes and high sample-rate uploads, version 0.
- 2025-09-24, clarified that `transcoder-slow` runs one job at a time on 6Gi pods, version 0.1.
- 2025-10-02, tightened requeue and diagnosis steps, version 1.
