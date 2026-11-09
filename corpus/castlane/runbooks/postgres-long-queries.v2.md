---
id: runbooks/postgres-long-queries.md@v2
source: runbooks
type: runbook
title: "Long-running queries on pg-feeds"
url: https://runbooks.castlane.internal/postgres-long-queries/v2
service: [pg-feeds]
allowed_groups: [eng, contractors]
author: mbe
version: 2
effective_at: 2026-06-18
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-06-18T14:27:00Z
generated: true
---
# Long-running queries on pg-feeds

This runbook covers long-running queries on the `pg-feeds` Postgres 18 cluster in the `feeds` namespace. It is owned by the data platform team, with day-to-day coordination from the feeds team. Use it when `pg-feeds` is healthy but one or more sessions are holding open transactions, blocking feed writes, or making the leader pod slow to respond.

## Diagnosis

1. Confirm the symptom in Grafana and Alertmanager, then look at active sessions on the leader pod. Exec into the leader in the `feeds` namespace and inspect `pg_stat_activity`, ordered by transaction start time.

```bash
kubectl -n feeds get pods -l app=pg-feeds
kubectl -n feeds exec -it pg-feeds-0 -- bash
```

```bash
psql -U postgres -d postgres -c "
SELECT
  pid,
  usename,
  datname,
  application_name,
  client_addr,
  state,
  xact_start,
  query_start,
  wait_event_type,
  wait_event,
  left(query, 200) AS query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start ASC;
"
```

2. Identify sessions owned by the feed builder role or anything that has been idle in transaction for too long. The feed builder role has a `statement_timeout` of 30s, and `idle_in_transaction_session_timeout` is 60s. Long-running statements beyond that are unusual and usually mean the session is not the current culprit, but a blocked transaction or a forgotten client.

```bash
psql -U postgres -d postgres -c "
SELECT
  pid,
  usename,
  application_name,
  state,
  now() - xact_start AS xact_age,
  now() - query_start AS query_age,
  wait_event_type,
  wait_event,
  left(query, 200) AS query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start ASC;
"
```

```bash
psql -U postgres -d postgres -c "
SELECT rolname, rolconfig
FROM pg_roles
WHERE rolname = 'feed_builder';
"
```

3. Check whether the long-running session is blocked by another backend or is blocking others. If the oldest transaction is waiting on a lock, inspect both sides before taking action.

```bash
psql -U postgres -d postgres -c "
SELECT
  a.pid AS blocked_pid,
  a.usename AS blocked_user,
  pg_blocking_pids(a.pid) AS blocking_pids,
  now() - a.xact_start AS blocked_age,
  left(a.query, 160) AS blocked_query
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid)) > 0
ORDER BY a.xact_start ASC;
"
```

4. If the session is a feed_builder publish transaction, treat it as special. Do not terminate it without the feeds team. Publishing is the path that builds and updates feeds, and a forced stop can leave work half-applied.

## Mitigation

1. Prefer cancellation first. Use `pg_cancel_backend` on the oldest offending backend, then re-check `pg_stat_activity`. This gives the query a chance to finish cleanly and release locks without aborting the whole session.

```bash
psql -U postgres -d postgres -c "SELECT pg_cancel_backend(12345);"
```

2. Re-check after 10 to 20 seconds. If the query exits and the transaction closes, no further action is needed. If it is still present and the session is not a feed_builder publish transaction, terminate it only after confirming it is safe.

```bash
psql -U postgres -d postgres -c "
SELECT pid, usename, state, now() - xact_start AS xact_age, left(query, 200)
FROM pg_stat_activity
WHERE pid = 12345;
"
```

```bash
psql -U postgres -d postgres -c "SELECT pg_terminate_backend(12345);"
```

3. If multiple sessions are affected, stop after the first cancellation and assess impact. A cluster-wide wave of long transactions often means a bad client release, a stuck migration, or a lock contention pattern that needs coordination rather than more force.

4. If the session belongs to `feed_builder` and the transaction is publishing, page the feeds team in `#feeds-dev` before any terminate action. Use cancellation only if they agree it is safe and the work can be retried.

## Escalation

Escalate to `tw`, `ok`, or `zi` in `#feeds-dev` if any of the following are true:

- The oldest transaction is a feed_builder publish transaction.
- `pg_cancel_backend` does not remove the session within a reasonable retry window.
- Multiple sessions are blocked behind one backend.
- `pg_feeds` remains slow after the session is gone.

Escalate to `mbe` if there is evidence of repeated long transactions from the same role or application, or if the leader pod shows repeated lock pressure after cleanup. If the leader pod itself is unhealthy, follow the standard Postgres cluster runbook and do not keep forcing backends.

## Reference settings

| Setting | Value | Notes |
|---|---:|---|
| `statement_timeout` for `feed_builder` | 30s | Queries should not run longer than this under normal operation. |
| `idle_in_transaction_session_timeout` | 60s | Idle sessions in a transaction should self-expire. |
| Preferred action order | cancel, then terminate | Always try `pg_cancel_backend` first. |
| Special case | feed_builder publish transaction | Never terminate without the feeds team. |

## History

- 2026-05-22, version 1: Initial runbook for identifying long-running transactions on `pg-feeds`, with focus on transaction age and lock blocking.
- 2026-06-10, version 1.1: Added explicit guidance to inspect the leader pod in the `feeds` namespace and to prefer cancellation before termination.
- 2026-06-18, version 2: Added the `feed_builder` timeout values, the `pg_stat_activity` ordering requirement, and the no-terminate rule for feed_builder publish transactions.
