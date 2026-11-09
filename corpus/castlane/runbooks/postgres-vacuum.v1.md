---
id: runbooks/postgres-vacuum.md@v1
source: runbooks
type: runbook
title: "Autovacuum and bloat on pg-feeds"
url: https://runbooks.castlane.internal/postgres-vacuum/v1
service: [pg-feeds]
allowed_groups: [eng, contractors]
author: mbe
version: 1
effective_at: 2025-12-09
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-12-09T16:45:00Z
generated: true
---
# Autovacuum and bloat on pg-feeds

This runbook covers table bloat and delayed vacuum on `pg-feeds`, the Postgres cluster used by the feeds service in the `feeds` namespace. The feeds team owns the workload, and the tables that usually churn are `episodes` and `feed_items`. The main symptoms are rising dead tuples, slower scans, and autovacuum that appears to stop making progress.

## Diagnosis

1. Confirm the problem is on `pg-feeds` and identify the table with the highest dead tuple count.

```sql
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  last_autovacuum,
  last_autoanalyze,
  vacuum_count,
  autovacuum_count
FROM pg_stat_user_tables
WHERE relname IN ('episodes', 'feed_items')
ORDER BY n_dead_tup DESC;
```

Look for `n_dead_tup` climbing over time and `last_autovacuum` not advancing. `feed_items` is usually the first table to show this because it churns with feed rebuilds and item pruning.

2. Check whether the table has the expected per-table autovacuum setting.

```sql
SELECT
  c.relname,
  pg_catalog.array_to_string(c.reloptions, ',') AS reloptions
FROM pg_class c
WHERE c.relname = 'feed_items';
```

`feed_items` should have `autovacuum_vacuum_scale_factor=0.02`. If that option is missing, autovacuum will wait too long on a busy table.

3. Check for a long transaction that can block vacuum from removing dead tuples.

```sql
SELECT
  pid,
  usename,
  state,
  xact_start,
  now() - xact_start AS xact_age,
  wait_event_type,
  wait_event,
  query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start ASC
LIMIT 10;
```

A transaction that has been open for a long time can keep old row versions visible and prevent vacuum from reclaiming space. On `pg-feeds`, pay attention to sessions that are idle in transaction or active for an unusually long time.

4. Confirm whether vacuum is already running and whether it is making progress.

```sql
SELECT
  pid,
  relid::regclass AS table_name,
  phase,
  heap_blks_scanned,
  heap_blks_total,
  index_vacuum_count,
  max_dead_tuples,
  num_dead_tuples
FROM pg_stat_progress_vacuum;
```

If vacuum is active but `heap_blks_scanned` is not advancing, check for blocking activity again. If there is no active vacuum and dead tuples remain high, run manual vacuum.

## Mitigation

1. If there is a long transaction and it is safe to stop, terminate it first. Only do this after checking the application impact.

```sql
SELECT pg_terminate_backend(<pid>);
```

Use the `pid` from `pg_stat_activity`. Do not terminate a session unless you have confirmed it is the blocker and it is safe to interrupt.

2. Run a manual vacuum on the affected table. `VACUUM (VERBOSE)` is safe during the day and is the preferred immediate action.

```sql
VACUUM (VERBOSE, ANALYZE) feed_items;
```

Use the same command for `episodes` if it also has high dead tuple counts. `ANALYZE` is included so planner stats catch up after the vacuum.

3. If the table is still growing dead tuples quickly, verify the per-table autovacuum setting is present.

```sql
ALTER TABLE feed_items SET (
  autovacuum_vacuum_scale_factor = 0.02
);
```

This keeps autovacuum aggressive enough for the churn pattern on `feed_items`.

4. If disk usage is the primary issue, do not use `VACUUM FULL` during the day. It takes an exclusive lock and can block reads and writes for too long. Schedule any rewrite outside business hours and only after confirming there is a real space reclamation need.

## Settings

| Table | Recommended setting | Reason |
| --- | --- | --- |
| `feed_items` | `autovacuum_vacuum_scale_factor = 0.02` | High churn, needs earlier vacuum runs |
| `episodes` | default unless metrics show sustained dead tuples | Lower churn than `feed_items` |

Check the effective settings after any change.

```sql
SELECT
  relname,
  reloptions
FROM pg_class
WHERE relname IN ('episodes', 'feed_items');
```

## Escalation

Escalate to `mbe` and `tw` if all of the following are true:

- `n_dead_tup` continues to climb after manual vacuum
- `last_autovacuum` is stale for more than one day on `feed_items`
- a long transaction cannot be safely terminated
- table growth is causing query latency or disk pressure

If the cluster is near disk limits, open a `PLAT-` ticket and include the output from `pg_stat_user_tables`, `pg_stat_activity`, and `pg_stat_progress_vacuum`. If the issue appears tied to application write patterns, loop in `zi` and `ok` for feed rebuild timing before making further storage changes.

## History

- 2025-12-09, version 1, initial runbook for autovacuum lag and bloat on `pg-feeds`.
- 2025-12-09, documented `feed_items` autovacuum tuning at `0.02` and the long transaction check.
- 2025-12-09, recorded that `VACUUM (VERBOSE)` is safe during the day and `VACUUM FULL` is not.
