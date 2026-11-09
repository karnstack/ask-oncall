---
id: runbooks/payout-batch-late.md@v2
source: runbooks
type: runbook
title: PayoutBatchLate
url: https://runbooks.castlane.internal/payout-batch-late/v2
service: [payouts, payouts-worker, pg-payouts, pgbouncer-payouts]
alerts: [PayoutBatchLate]
scope: payouts
allowed_groups: [eng]
author: cv
version: 2
effective_at: 2026-02-03
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-09-30T08:10:00Z
---

# PayoutBatchLate

The monthly creator payout batch has not finished on time. Creators are
paid once a month. The batch starts at 06:00 UTC on the 15th and usually
finishes in 30 to 45 minutes.

## Meaning

```
payouts_batch_last_success_timestamp_seconds < (start of the 15th) and hour() >= 8
for: 5m
```

It is 08:00 UTC or later on payout day and the batch has not recorded a
success. It is not about one payout failing: single failures are retried by
the batch and show up in the run summary.

## Impact

Creators are not paid on time. Support starts getting tickets about an hour
after the usual arrival time. Money is never lost by a late batch; the risk
is paying twice if someone restarts it wrongly.

## Diagnosis

1. Is the batch held on purpose? Check the flag:

   ```
   flagctl get payouts.batch_enabled
   ```

   `false` with a reason means someone held it. Find the incident in the
   reason and ask there. Do not release it yourself.
2. Is it running? The batch is a Kubernetes Job created by the CronJob
   `payouts-batch`:

   ```
   kubectl -n payouts get jobs -l app=payouts-batch --sort-by=.metadata.creationTimestamp
   kubectl -n payouts logs job/payouts-batch-<date> --tail=100
   ```

   Progress lines look like `batch=2026-09 paid=31200/48210`.
3. Did it fail? `KubeJobFailed` for `payouts-batch-*` usually fires first.
   Look for `provider timeout` (the payment provider is slow, see the
   provider timeouts runbook) or `ledger lock` (another job holds the ledger
   lock, usually a manual reconcile someone forgot).
4. Is the database fine? pgbouncer-payouts pools (`SHOW POOLS;` on the
   admin console) and pg-payouts leader health (`patronictl list` in
   namespace `payouts`).

## Mitigation

- Held on purpose: leave it. Acknowledge the page and post in the incident.
- Failed: the batch is idempotent per creator (`payout_id` is unique per
  creator and month). Re-run it with:

  ```
  kubectl -n payouts create job payouts-batch-rerun-$(date +%s) --from=cronjob/payouts-batch
  ```

  It skips creators already paid this month.
- Never run two batch Jobs at the same time. Check `kubectl -n payouts get jobs`
  first. The ledger lock should stop the second one, but do not test it.
- Post in `#oncall-payouts` and `#incidents`. If creators will be paid more
  than 4 hours late, ask support to post on the status page.

## Escalation

payouts-eng on-call (the `payouts` schedule in the on-call tool), then cv
or jh. Contractors are not on the payouts rotation.

## History

- 2026-09-30: pg-payouts check uses `patronictl` (Patroni since June).
- v2 (2026-02-03): added the held-on-purpose check and the rerun command.
- v1 (2025-05): first version.
