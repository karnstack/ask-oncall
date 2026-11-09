---
id: adr/ADR-0012-pgbouncer-transaction-pooling.md
source: adr
type: adr
title: "ADR-0012: PgBouncer in transaction pooling mode"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0012-pgbouncer-transaction-pooling.md
service: [pgbouncer-feeds, pgbouncer-payouts]
allowed_groups: [eng]
author: mbe
version: 1
effective_at: 2024-01-16
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2024-01-16T15:26:00Z
generated: true
---
# ADR-0012: PgBouncer in transaction pooling mode

Status: Accepted, Date: 2024-01-16, Deciders: mbe, zi, nd

## Context

Castlane services open many short-lived PostgreSQL connections. The write path in `prod-us-east` and the feed-serving path in `prod-eu-west` both show the same pattern: application pods connect, run a small number of statements, then disconnect. Without connection pooling, the database spends too much time on connection setup, authentication, and backend process management.

We operate two PostgreSQL 18 clusters, `pg-feeds` and `pg-payouts`, both fronted by PgBouncer deployments `pgbouncer-feeds` and `pgbouncer-payouts`. The operational goal is to keep database connection overhead predictable for the apps and to protect PostgreSQL from connection spikes during deploys, retries, and batch jobs.

Transaction pooling fits this workload. It allows a client connection to be attached to a PostgreSQL backend only for the duration of a transaction, then returned to the pool immediately. That is the right boundary for Castlane request handlers and worker jobs, which should already treat each transaction as the unit of work.

## Decision

We will run PgBouncer in `transaction` pooling mode in front of every production database.

For both `pgbouncer-feeds` and `pgbouncer-payouts`, the baseline configuration is:

```ini
pool_mode = transaction
server_reset_query = DISCARD ALL
ignore_startup_parameters = extra_float_digits
admin_users = mbe, zi, nd
stats_users = mbe
```

The database connection string used by applications must point at PgBouncer, not directly at PostgreSQL. Services that talk to `pg-feeds` include `feed-builder`, `private-feeds`, and `download-stats`. Services that talk to `pg-payouts` include `payouts` and `payouts-worker`.

Application code must not rely on session state surviving past a transaction. In practice, this means:

| Feature | Allowed |
| --- | --- |
| `SET` for session state | No |
| Advisory locks outside a transaction | No |
| Prepared statements outside a transaction | No |
| Temporary tables across multiple transactions | No |

SQL that depends on server state must be explicit and transaction-scoped:

```sql
BEGIN;
SET LOCAL statement_timeout = '3s';
INSERT INTO payout_runs (run_id, created_at)
VALUES ($1, now());
COMMIT;
```

## Consequences

Good:

1. PostgreSQL backend usage becomes much steadier under bursty request traffic.
2. Short-lived app connections stop translating directly into PostgreSQL process churn.
3. Deploys and worker restarts are less likely to exhaust the database with transient connection spikes.
4. Pooling is consistent across `pg-feeds` and `pg-payouts`, so operational debugging is simpler.

Bad:

1. Apps cannot depend on session state. Any code that uses `SET`, advisory locks, or prepared statements outside a transaction must be changed.
2. Some database client libraries behave poorly when they assume a sticky server session. We need to verify each service’s behavior explicitly.
3. Debugging can be less direct because the client connection and PostgreSQL backend connection are not the same for the life of the session.

## Alternatives considered

1. **Session pooling**  
   Rejected because it keeps one PostgreSQL backend pinned per client session. That does not solve the connection pressure caused by short-lived application connections.

2. **Direct connections to PostgreSQL without PgBouncer**  
   Rejected because connection setup cost and backend process overhead would remain on the database. This is fragile during retries, deploys, and batch activity.

3. **Statement pooling**  
   Rejected because it is too restrictive for Castlane workloads. Several services need multi-statement transactions, and statement pooling would break that pattern.
