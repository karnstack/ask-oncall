---
id: runbooks/db-password-rotation.md@v1
source: runbooks
type: runbook
title: "Rotating database passwords for app users"
url: https://runbooks.castlane.internal/db-password-rotation/v1
service: [pgbouncer-feeds, pgbouncer-payouts, pg-feeds, pg-payouts]
allowed_groups: [eng, contractors]
author: sec-ir
version: 1
effective_at: 2026-03-10
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-03-10T13:20:00Z
generated: true
---
# Rotating database passwords for app users

This runbook covers the 90 day password rotation for Castlane application database users in the `feeds` and `payouts` stacks. The work touches the Postgres clusters `pg-feeds` and `pg-payouts`, the PgBouncer deployments `pgbouncer-feeds` and `pgbouncer-payouts`, and the application Secrets in Kubernetes. Ownership is split across `feeds` and `payouts`, with security handling the rotation job.

## Rotation targets

| Cluster | App user | Secret path |
| --- | --- | --- |
| `pg-feeds` | `feed_builder` | app Secret for `feed-builder` |
| `pg-feeds` | `upload_api` | app Secret for `upload-api` |
| `pg-feeds` | `private_feeds` | app Secret for `private-feeds` |
| `pg-feeds` | `stats_reader` | app Secret for `download-stats` |
| `pg-payouts` | `payouts_app` | app Secret for `payouts` |
| `pg-payouts` | `payouts_batch` | app Secret for `payouts-worker` |

## Diagnosis

1. **[2026-03-10 09:10 UTC] Confirm the symptom and scope.**  
   If an app logs `password authentication failed`, first confirm which pod and which database user are affected.

   ```bash
   kubectl --context prod-us-east -n feeds logs deploy/feed-builder --since=30m | grep -n "password authentication failed"
   kubectl --context prod-us-east -n media logs deploy/upload-api --since=30m | grep -n "password authentication failed"
   kubectl --context prod-eu-west -n feeds logs deploy/private-feeds --since=30m | grep -n "password authentication failed"
   kubectl --context prod-eu-west -n feeds logs deploy/download-stats --since=30m | grep -n "password authentication failed"
   kubectl --context prod-us-east -n payouts logs deploy/payouts --since=30m | grep -n "password authentication failed"
   kubectl --context prod-us-east -n payouts logs deploy/payouts-worker --since=30m | grep -n "password authentication failed"
   ```

2. **[2026-03-10 09:15 UTC] Check the three copies are in sync.**  
   The password must match in Postgres, the PgBouncer `userlist.txt` Secret, and the application Secret. Start with the user in Postgres.

   ```bash
   psql "host=pg-feeds-rw.prod-us-east.svc.cluster.local dbname=postgres user=postgres" -c "\du+ feed_builder"
   psql "host=pg-feeds-rw.prod-us-east.svc.cluster.local dbname=postgres user=postgres" -c "\du+ upload_api"
   psql "host=pg-payouts-rw.prod-us-east.svc.cluster.local dbname=postgres user=postgres" -c "\du+ payouts_app"
   psql "host=pg-payouts-rw.prod-us-east.svc.cluster.local dbname=postgres user=postgres" -c "\du+ payouts_batch"
   ```

   Then inspect the Secrets.

   ```bash
   kubectl --context prod-us-east -n feeds get secret pgbouncer-feeds-userlist -o jsonpath='{.data.userlist\.txt}' | base64 -d
   kubectl --context prod-us-east -n feeds get secret feed-builder-db -o jsonpath='{.data.password}' | base64 -d
   kubectl --context prod-us-east -n media get secret upload-api-db -o jsonpath='{.data.password}' | base64 -d
   kubectl --context prod-eu-west -n feeds get secret private-feeds-db -o jsonpath='{.data.password}' | base64 -d
   kubectl --context prod-eu-west -n feeds get secret download-stats-db -o jsonpath='{.data.password}' | base64 -d
   kubectl --context prod-us-east -n payouts get secret payouts-db -o jsonpath='{.data.password}' | base64 -d
   kubectl --context prod-us-east -n payouts get secret payouts-worker-db -o jsonpath='{.data.password}' | base64 -d
   ```

3. **[2026-03-10 09:20 UTC] Check PgBouncer health after the last rotation.**  
   If only one app fails, a stale Secret is the most common cause. If multiple apps fail on the same cluster, check whether the rotation job updated Postgres and PgBouncer, but missed the app Secret, or whether the reload did not land.

   ```bash
   kubectl --context prod-us-east -n feeds get pods -l app=pgbouncer-feeds
   kubectl --context prod-us-east -n payouts get pods -l app=pgbouncer-payouts
   kubectl --context prod-us-east -n feeds logs deploy/pgbouncer-feeds --since=30m | tail -n 50
   kubectl --context prod-us-east -n payouts logs deploy/pgbouncer-payouts --since=30m | tail -n 50
   ```

## Mitigation

1. **[2026-03-10 09:30 UTC] Re-run the secrets job for the affected cluster.**  
   Use the security-owned job or the rotation automation that updates Postgres, `userlist.txt`, and the app Secret in one pass. After the update, issue `RELOAD` to PgBouncer so it rereads `userlist.txt`.

   ```bash
   kubectl --context prod-us-east -n feeds rollout restart deploy/pgbouncer-feeds
   kubectl --context prod-us-east -n payouts rollout restart deploy/pgbouncer-payouts
   ```

   If the job is available as a Kubernetes CronJob in your environment, trigger it manually and watch the logs until it reports success for all six users.

2. **[2026-03-10 09:35 UTC] Verify the new password landed everywhere.**  
   Confirm the app can authenticate through PgBouncer and directly to Postgres for a quick check. Use the specific user for the service you are validating.

   ```bash
   kubectl --context prod-us-east -n feeds exec deploy/feed-builder -- sh -lc 'psql "host=pgbouncer-feeds.feeds.svc.cluster.local dbname=postgres user=feed_builder" -c "select 1"'
   kubectl --context prod-us-east -n media exec deploy/upload-api -- sh -lc 'psql "host=pgbouncer-feeds.feeds.svc.cluster.local dbname=postgres user=upload_api" -c "select 1"'
   kubectl --context prod-eu-west -n feeds exec deploy/private-feeds -- sh -lc 'psql "host=pgbouncer-feeds.feeds.svc.cluster.local dbname=postgres user=private_feeds" -c "select 1"'
   kubectl --context prod-us-east -n payouts exec deploy/payouts -- sh -lc 'psql "host=pgbouncer-payouts.payouts.svc.cluster.local dbname=postgres user=payouts_app" -c "select 1"'
   ```

3. **[2026-03-10 09:40 UTC] Watch for recovery in logs.**  
   The error should stop within a few minutes once the app Secret and PgBouncer are aligned.

   ```bash
   kubectl --context prod-us-east -n feeds logs deploy/feed-builder --since=10m | grep -n "password authentication failed"
   kubectl --context prod-us-east -n payouts logs deploy/payouts-worker --since=10m | grep -n "password authentication failed"
   ```

## Escalation

1. **[2026-03-10 09:50 UTC] Escalate to `sec-ir` if the rotation job cannot update all three copies.**  
   Include the cluster, the user, the Secret name, and the exact timestamp when the mismatch started. If the job succeeded but the app still fails, page the owner team in `#feeds-dev` or `#oncall-payouts` with the failing user and the last successful rotation time.

2. **[2026-03-10 09:55 UTC] Escalate to `mbe` if Postgres accepts the new password inconsistently.**  
   That points to a database-side issue, not an app rollout issue. Provide the output of `\du+` and the PgBouncer logs from the same window.

3. **[2026-03-10 10:00 UTC] Escalate to `dara` if the automation or the rotation workflow itself is broken.**  
   Ask in `#platform` for a second pair of eyes, then open a ticket with the rotation timestamp, affected services, and whether the reload was attempted.

## History

- **2026-03-10 10:05 UTC, version 1**: Initial runbook published for app user password rotation across `pg-feeds` and `pg-payouts`.
- **2026-03-10 10:05 UTC**: Added the three-way sync check for Postgres, PgBouncer `userlist.txt`, and application Secrets.
- **2026-03-10 10:05 UTC**: Documented PgBouncer reload after rotation and the service list for `feed_builder`, `upload_api`, `private_feeds`, `stats_reader`, `payouts_app`, and `payouts_batch`.
