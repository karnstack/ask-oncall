---
id: runbooks/postgres-replica-lag.md@v1
source: runbooks
type: runbook
title: "Replica lag on pg-feeds-repl"
url: https://runbooks.castlane.internal/postgres-replica-lag/v1
service: [pg-feeds]
allowed_groups: [eng, contractors]
author: ne
version: 1
effective_at: 2026-07-07
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-07-07T13:20:00Z
generated: true
---
# Replica lag on pg-feeds-repl

`pg-feeds-repl` is the read path for `feeds_ro`, which covers stats reads and private feed reads. It lives in the `feeds` namespace and is owned by the feeds team. When it falls behind the leader, private feeds can show a newly published episode a few seconds late, but this is usually a read freshness issue, not a data loss issue.

## Diagnosis

1. Confirm the symptom is read lag, not a write outage. Check whether new episodes are present on the leader and only missing on reads from `feeds_ro`.

```bash
kubectl -n feeds get pods -o wide | grep pg-feeds
psql "host=pg-feeds leader dbname=castlane user=readonly" -c \
  "select now(), max(published_at) from episodes where show_id = 'SHOW123';"
psql "host=pg-feeds-repl dbname=castlane user=readonly" -c \
  "select now(), max(published_at) from episodes where show_id = 'SHOW123';"
```

2. Check replay lag on the leader. `replay_lag` is how far behind the replica is when applying changes from the leader. A small lag in seconds is usually acceptable, but a growing or steady lag points to an underlying bottleneck.

```bash
psql "host=pg-feeds leader dbname=castlane user=readonly" -c \
  "select application_name, state, sync_state, \
          coalesce(write_lag, interval '0') as write_lag, \
          coalesce(replay_lag, interval '0') as replay_lag, \
          client_addr \
   from pg_stat_replication;"
```

3. Look for long running queries on the replica. A common cause is a read query holding a snapshot for a long time while `hot_standby_feedback` is active, which can slow cleanup on the leader and make replay fall behind.

```bash
psql "host=pg-feeds-repl dbname=castlane user=readonly" -c \
  "select pid, usename, state, now() - query_start as age, wait_event_type, wait_event, left(query, 120) as query
   from pg_stat_activity
   where state <> 'idle'
   order by age desc;"
```

4. Check for a large migration or bulk write on `pg-feeds`. If a migration is running, lag often rises while the replica catches up after the write burst.

```bash
kubectl -n feeds get jobs
kubectl -n feeds logs deploy/feed-builder --since=30m | tail -n 100
psql "host=pg-feeds leader dbname=castlane user=readonly" -c \
  "select datname, conflicts, deadlocks from pg_stat_database where datname = 'castlane';"
```

5. Check storage latency on the replica node. A slow volume can make WAL replay slower even when the leader is healthy.

```bash
kubectl -n feeds describe pod -l app=pg-feeds-repl | sed -n '/Events:/,$p'
kubectl -n feeds top pod -l app=pg-feeds-repl
kubectl -n feeds get pvc | grep pg-feeds-repl
```

## Mitigation

1. If the lag is tied to one or two long queries on the replica, cancel those queries first. This usually clears the blockage without touching the leader.

```bash
psql "host=pg-feeds-repl dbname=castlane user=readonly" -c \
  "select pg_cancel_backend(pid)
   from pg_stat_activity
   where state <> 'idle'
     and now() - query_start > interval '5 minutes';"
```

2. If a bulk migration or other heavy write is in progress, let it finish if possible. The replica usually catches up on its own once the write burst ends. If the migration is optional and causing user-visible staleness, pause the job or coordinate with the feed owner before retrying.

```bash
kubectl -n feeds get jobs
kubectl -n feeds delete job <migration-job-name>
```

3. If storage latency is the problem, page the platform side of the data stack and include the PVC and node details. Do not restart the leader just to reduce lag. There is no switchover needed for this issue, and a restart can make the read gap worse before it gets better.

4. If the lag is small, keep watching it. Private feed reads can be a few seconds stale without breaking correctness, so only escalate if the lag grows or stays high for more than about 15 minutes.

## Escalation

Escalate to `#feeds-dev` and tag `@mbe` if the replay lag keeps growing, if there is a suspected storage issue, or if you see repeated query cancellations on the replica. If the issue is clearly tied to Kubernetes scheduling, node pressure, or volume health, also post in `#platform` with the pod, node, and PVC names.

Useful details to include:

- current `replay_lag`
- whether the leader has a burst of writes
- whether there are long queries on `pg-feeds-repl`
- whether the problem affects only private feeds, or also stats reads

If the lag is producing a user-facing incident, open an incident channel with `/incident` and keep the update short, for example: "Replica lag on `pg-feeds-repl` is delaying private feed reads by a few seconds, leader writes are healthy, investigating long replica queries and storage latency."

## History

- 2026-07-07, version 1, initial runbook for `pg-feeds-repl` replica lag on `feeds_ro`.
- 2026-07-03, added guidance on checking `replay_lag` in `pg_stat_replication` and distinguishing read freshness from write failure.
- 2026-06-28, draft notes captured during a private feed staleness investigation, later turned into this runbook.
