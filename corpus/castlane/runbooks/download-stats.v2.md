---
id: runbooks/download-stats.md@v2
source: runbooks
type: runbook
title: "download-stats pipeline lag"
url: https://runbooks.castlane.internal/download-stats/v2
service: [download-stats]
alerts: [KubeJobFailed]
allowed_groups: [eng, contractors]
author: zi
version: 2
effective_at: 2025-08-12
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-08-12T15:38:00Z
generated: true
---
# download-stats pipeline lag

`download-stats` is the job path that turns edge logs into creator-facing download counts. It runs in the `feeds` namespace, and we own it on the feeds team because the output feeds the creator dashboards and the monthly payout inputs. The job deduplicates downloads per IP and user agent in a 24 hour window, then aggregates the results hourly through the `stats-hourly` CronJob.

A lag here means the creator dashboards are stale, and nothing else should be affected. We usually see this when an hourly run failed, a manual rerun was missed, or the job backed up behind an earlier bad run.

## Alerts that link here

- `KubeJobFailed`

## Diagnosis

1. Confirm the job is actually behind, and identify the last successful hourly run.

```bash
kubectl -n feeds get cronjob stats-hourly
kubectl -n feeds get jobs --sort-by=.status.startTime | tail -n 20
kubectl -n feeds describe cronjob stats-hourly
```

We look for missing hourly jobs, failed completions, or a gap in the recent job list. If the CronJob itself is suspended or misconfigured, that is usually visible in the `describe` output.

2. Check whether the most recent job failed for a data issue or a pod issue.

```bash
kubectl -n feeds get pods -l job-name=stats-hourly -o wide
kubectl -n feeds logs job/stats-hourly --all-containers=true --tail=200
kubectl -n feeds describe job stats-hourly
```

We usually care about one of three patterns: log ingestion could not read edge logs, the dedupe step saw an unexpected schema change, or the pod never reached completion. If the pod is restarting or pending, compare it with the other feeds workloads to see whether the namespace is under pressure.

3. Verify the queueing and storage inputs that the job depends on.

```bash
kubectl -n feeds get pods
kubectl -n feeds get pvc
kubectl -n feeds top pod
```

If we see widespread pod scheduling trouble or a storage issue, the hourly job may be healthy but unable to finish. We do not need to chase the dashboard symptom until we know the job itself is blocked.

4. Confirm that the stale window is only one missed hour before we rerun anything.

```bash
kubectl -n feeds get jobs --sort-by=.metadata.creationTimestamp | grep stats-hourly
```

If we have already rerun the same hour once, do not rerun it again without `--replace`. That avoids duplicating a day’s work and makes the history easier to reason about.

## Extra context: what the job does

The pipeline reads edge logs, deduplicates downloads by IP and user agent within a rolling 24 hour window, then writes hourly aggregates that the dashboards consume. That means a single failed hour can leave the creator view behind until we replay it. The job is intentionally hourly because we want fresh enough numbers without making the dedupe window expensive to rebuild.

## Mitigation

If the failure was isolated to one hour, we rerun that hour manually from the CronJob template.

```bash
kubectl -n feeds create job stats-hourly-manual-20250812t1530z --from=cronjob/stats-hourly
```

Use a timestamped name that clearly identifies the hour we are replaying. If we already reran that same day once, add `--replace` so we do not create duplicate manual jobs for the same period.

```bash
kubectl -n feeds create job stats-hourly-manual-20250812t1530z --from=cronjob/stats-hourly --replace
```

After the rerun starts, watch it to completion and then check that the dashboard lag clears.

```bash
kubectl -n feeds get jobs --watch
kubectl -n feeds logs job/stats-hourly-manual-20250812t1530z --tail=200
```

If the CronJob keeps failing on every hour, stop and treat it as a broader incident. We should not keep replaying hours if the underlying cause is still present.

## Escalation

If the job fails more than once in a row, or if the rerun cannot complete, escalate in `#feeds-dev` and link the job name, the failing hour, and the log output. If the issue looks like a namespace or cluster problem, also notify `#platform` because the feeds workloads share the same Kubernetes and storage path as the rest of the serving side.

If the stale dashboard is causing creator support volume, post a short status update in `#incidents` with the current impact. If the job is blocked by infrastructure, we can also page through the standard incident flow with `/incident`.

## History

- 2025-08-12, version 2. Clarified that lag only affects creator dashboards, and added the manual rerun command with the `--replace` warning for repeated day replays.
- 2025-06-03, version 1. Added the hourly replay path for `stats-hourly` after we had to recover several missed aggregation windows from failed CronJob runs.
- 2025-04-18, version 0. Documented the initial pipeline and the dedupe rule for IP plus user agent over a 24 hour window.
