---
id: adr/ADR-0027-cronjobs.md
source: adr
type: adr
title: "ADR-0027: Kubernetes CronJobs instead of the cron VM"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0027-cronjobs.md
service: [platform]
allowed_groups: [eng]
author: hq
version: 1
effective_at: 2025-02-04
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-02-04T10:59:00Z
generated: true
---
# ADR-0027: Kubernetes CronJobs instead of the cron VM

Status: Accepted, Date: 2025-02-04, Deciders: @hq, @ne, @mbe

## Context

- We run several scheduled platform tasks today from one cron VM.
- The VM is a single point of failure.
- Job runs have no first-class alerting.
- Failures can sit unnoticed until someone checks logs by hand.
- Logs live outside the normal Kubernetes logging path, so they are harder to search, correlate, and retain.
- We already operate the rest of the platform on Kubernetes, so the VM is the odd system out.

**Warning:** if a scheduled job fails on the VM, there is no automatic page and no clear owner signal.

## Decision

- Move scheduled platform jobs from the cron VM to Kubernetes CronJobs.
- Run each task as its own CronJob object in the owning namespace.
- Set `concurrencyPolicy: Forbid` on every CronJob.
- Set `startingDeadlineSeconds` only where the job can safely skip a missed run, otherwise leave it unset.
- Use explicit resource requests and limits for each job.
- Send stdout and stderr to container logs only.
- Keep logs in the standard Kubernetes logging pipeline, so they land in the same place as other service logs and are visible in Grafana and the cluster log search path.
- Add `KubeJobFailed` alerting for every CronJob-backed scheduled task.
- Alert on failed runs quickly enough that the oncall can act before the next scheduled window.
- Keep alert routing in the normal paging path used for kube-prometheus alerts.
- Keep the old VM in place during migration, but stop using it for any new scheduled work.

**Warning:** do not run overlapping job instances. `concurrencyPolicy: Forbid` is required, not optional.

## Consequences

### Good

- Jobs get native Kubernetes scheduling, retries, and lifecycle tracking.
- Failures show up in `KubeJobFailed`, which is much easier to notice than a silent VM log scrape.
- Logs are visible with the rest of the platform workload logs.
- Ownership is clearer, since each CronJob sits in the namespace for the service that owns it.
- We reduce dependence on one manually maintained VM.
- We can roll out job changes with normal Kubernetes deployment practices.

### Bad

- CronJob manifests add more Kubernetes objects to maintain.
- Short jobs can still fail if the cluster is unhealthy at the scheduled time.
- We need to watch for missed schedules during cluster incidents and maintenance windows.
- Some existing scripts need cleanup so they behave well in containers.
- Alert noise is possible if a job is flaky and keeps failing.

**Warning:** a bad job container can still fail fast and fail often, so script hygiene matters.

## Alternatives considered

### Keep the cron VM

- Rejected because it has no native alerting, weak ownership boundaries, and a separate logging path.
- Rejected because it keeps platform scheduling outside Kubernetes for no real benefit.

### Use a single Kubernetes Deployment with an internal scheduler loop

- Rejected because it re-creates cron logic in application code.
- Rejected because it makes alerting and per-job lifecycle tracking harder.
- Rejected because it concentrates multiple schedules into one process.

### Move scheduled work to ad hoc manual runs

- Rejected because the work is repeatable and should not depend on humans remembering to run it.
- Rejected because it makes outages and missed runs more likely.
