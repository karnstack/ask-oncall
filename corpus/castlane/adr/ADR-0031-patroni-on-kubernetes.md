---
id: adr/ADR-0031-patroni-on-kubernetes.md
source: adr
type: adr
title: "ADR-0031: Run pg-feeds and pg-payouts on Kubernetes with Patroni"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0031-patroni-on-kubernetes.md
service: [pg-feeds, pg-payouts, pgbouncer-feeds, pgbouncer-payouts]
allowed_groups: [eng]
author: mbe
version: 1
effective_at: 2026-04-09
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-06-18T09:30:00Z
---

# ADR-0031: Run pg-feeds and pg-payouts on Kubernetes with Patroni

Status: accepted, implemented 2026-06-16. Date: 2026-04-09. Deciders: mbe,
rs, dara, cv.

## Context

Postgres runs on five `db` VMs with repmgr: pg-feeds-1 to 3, pg-payouts-1
and 2. Everything else is on Kubernetes. The VMs are the only machines we
patch by hand.

Failover with repmgr is manual for planned switchovers and needs a
PgBouncer config edit afterwards, because PgBouncer points at the primary by
hostname. In INC-1873 that edit was the slowest and most error-prone step
(PLAT-3903). repmgrd's automatic failover has never fired in production, so
we do not really know whether it works.

## Decision

Move both clusters to Kubernetes as StatefulSets managed by Patroni, using
the Kubernetes API as the DCS (no etcd or Consul of our own).

- Patroni holds the leader lock in a Kubernetes object and fails over by
  itself when the leader stops renewing it (`ttl: 30`, `loop_wait: 10`).
- `maximum_lag_on_failover: 1048576` (1 MB). A replica further behind is
  never promoted automatically.
- Services `pg-feeds` and `pg-payouts` always point at the leader;
  `pg-feeds-repl` points at the replicas. PgBouncer connects through them,
  so a failover never needs a PgBouncer change.
- Planned switchovers use `patronictl switchover`. The runbook gets a new
  major version.
- Replication stays asynchronous. Synchronous mode costs about 2 ms per
  commit on feeds, and we would rather pause writes for a planned switchover.

## Consequences

- One less class of machine to patch. Postgres upgrades become image bumps.
- Volumes are network block storage. Latency is a little higher than the
  VMs' local disks; benchmarks in PLAT-4120 showed p99 commit 3.1 ms vs 2.4 ms.
- Everyone on the rotation needs to unlearn repmgr. The v2 failover runbook
  will be deleted on cutover, not kept as superseded: its commands do not
  exist on the new pods.
- PgBouncer's pool sizing is unchanged by this move. Revisit if the
  PgBouncer pod count changes.

## Cutover

pg-payouts on 2026-06-09, pg-feeds on 2026-06-16, both with logical
replication from the VMs and a 4-minute write pause. VMs deleted 2026-06-30.
