---
id: runbooks/postgres-failover.md@v3
source: runbooks
type: runbook
title: Postgres failover (Patroni)
url: https://runbooks.castlane.internal/postgres-failover/v3
service: [pg-feeds, pg-payouts]
alerts: [FeedBuildLagHigh, KubePersistentVolumeErrors]
allowed_groups: [eng, contractors]
author: mbe
version: 3
effective_at: 2026-06-18
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-06-18T09:15:00Z
---

# Postgres failover (Patroni)

Controlled switchover of the Postgres leader in `pg-feeds` or `pg-payouts` to
a replica. Since 2026-06-16 both clusters run Postgres 18 on Kubernetes under
Patroni (ADR-0031). Patroni fails over by itself when the leader dies. Run
this only when the leader is alive but should not be: a degraded volume, a
node to drain, a planned move.

There is no repmgr anywhere any more. If a page or a postmortem tells you to
run repmgr, it is from before June 2026. Ignore it.

## Before you start

- `pg-feeds`: namespace `feeds`, pods `pg-feeds-0` to `pg-feeds-2`.
  `pg-payouts`: namespace `payouts`, pods `pg-payouts-0`, `pg-payouts-1`.
- Open an incident first (`/incident` in Slack) and use its INC number below.

## Procedure (7 steps)

### 1. Find the leader

```
kubectl -n feeds exec pg-feeds-0 -c postgres -- patronictl list
```

```
+ Cluster: pg-feeds (7398112264590123011) ---+----+-----------+
| Member     | Host       | Role    | State     | TL | Lag in MB |
+------------+------------+---------+-----------+----+-----------+
| pg-feeds-0 | 10.42.3.17 | Leader  | running   | 14 |           |
| pg-feeds-1 | 10.42.5.9  | Replica | streaming | 14 |         0 |
| pg-feeds-2 | 10.42.7.22 | Replica | streaming | 14 |         0 |
```

### 2. Pick the candidate

A replica that is `streaming` with `Lag in MB` at 0, on a different node
from the leader (`kubectl -n feeds get pod -o wide`). Lag growing? Stop and
page data platform.

### 3. Silence the noise and tell people

```
amtool silence add -d 30m -c "INC-NNNN pg-feeds switchover" cluster=pg-feeds
```

Post in `#incidents`: "pg-feeds switchover, writes paused for 5 min."

### 4. Pause writes

```
flagctl set feeds.writes_paused true --reason "INC-NNNN pg-feeds switchover"
```

Replication is asynchronous. Patroni will not promote a replica more than
`maximum_lag_on_failover` (1 MB) behind, but writes in flight at the moment
of the switch can still be lost. Do not skip this step.

feed-builder and upload-api stop writing and queue work in Redis. Confirm on
one pgbouncer-feeds pod that the write pool has drained:

```
kubectl -n feeds exec deploy/pgbouncer-feeds -- psql -h 127.0.0.1 -p 6432 -U pgbouncer pgbouncer -c "SHOW POOLS;"
```

`cl_active` for database `feeds`, user `feed_builder` should reach 0 within
a minute. Reads (`feeds_ro`) keep working.

### 5. Switch over

```
kubectl -n feeds exec -it pg-feeds-0 -c postgres -- patronictl switchover pg-feeds --leader pg-feeds-0 --candidate pg-feeds-1 --force
```

### 6. Verify

Run `patronictl list` again. The candidate must be `Leader`, the old leader
`Replica` and `streaming`, TL one higher. Then on every pgbouncer-feeds pod:

```
kubectl -n feeds exec <pod> -- psql -h 127.0.0.1 -p 6432 -U pgbouncer pgbouncer -c "RECONNECT feeds;"
```

This closes pooled server connections to the old leader as they are released.
The `pg-feeds` service always points at the leader and `pg-feeds-repl` at the
replicas, so you never edit PgBouncer config during a switchover.

### 7. Resume writes

```
flagctl set feeds.writes_paused false --reason "INC-NNNN done"
```

Watch `FeedBuildLagHigh` clear (usually under 10 minutes, the backlog in
Redis drains first). Post in `#incidents`.

## If the leader is already dead

Do nothing for 30 seconds. Patroni's `ttl` is 30 s; a replica takes the lock
and the `pg-feeds` service follows it. Check with `patronictl list`. Only if
the cluster shows no leader after 2 minutes:

```
kubectl -n feeds exec -it pg-feeds-1 -c postgres -- patronictl failover pg-feeds --candidate pg-feeds-1 --force
```

## pg-payouts

Same 7 steps in namespace `payouts` with `pg-payouts-0` and `pg-payouts-1`.
In step 4 use `flagctl set payouts.writes_paused true`. Never switch over
during the monthly payout run (06:00 to 08:00 UTC on the 15th) unless
`payouts-eng` agrees in the incident channel.

## History

- v3 (2026-06-18): rewritten for Patroni on Kubernetes. v2 (repmgr on the
  `db` VMs) deleted, the VMs are gone.
