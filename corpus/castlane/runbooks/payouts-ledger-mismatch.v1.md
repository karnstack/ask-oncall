---
id: runbooks/payouts-ledger-mismatch.md@v1
source: runbooks
type: runbook
title: "Ledger mismatch after a payout run"
url: https://runbooks.castlane.internal/payouts-ledger-mismatch/v1
service: [payouts, pg-payouts]
scope: payouts
allowed_groups: [eng]
author: cv
version: 1
effective_at: 2025-12-18
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-12-18T16:41:00Z
generated: true
---
# Ledger mismatch after a payout run

This runbook covers a mismatch between the internal payouts ledger and the payment provider settlement file after a monthly payout run. The issue lives in the `payouts` namespace and is owned by the payouts team. A mismatch blocks the next run until we reconcile the difference to the cent and decide whether the ledger or the settlement file is the source of truth for the affected entries.

## Diagnosis

1. Confirm the last run failed in the expected place and that the blocker is a ledger mismatch, not an unrelated job failure.

```bash
kubectl -n payouts get jobs
kubectl -n payouts logs job/payouts-2025-12-15 --container=payouts
kubectl -n payouts logs deploy/payouts-worker --since=24h | grep -E 'reconcile|mismatch|settlement'
```

2. Run the reconcile report for the affected month. Use the month that contains the failed payout batch.

```bash
payouts-admin reconcile --month 2025-12 --explain
```

This prints the ledger total, the settlement total, and the exact difference. Save the output in the incident channel. If the report lists individual rows, note the payout IDs and the currency for each row.

3. Check whether the difference is a rounding issue in one currency. This usually shows up as a one cent delta on a small number of rows.

```bash
psql "$PAYOUTS_DB_URL" -c "
select currency,
       count(*) as rows,
       sum(amount_cents) as ledger_cents
from payouts_ledger_entries
where payout_month = date '2025-12-01'
group by currency
order by currency;"
```

Compare the cent totals to the settlement lines from `--explain`. If only one currency is off by 1 cent or 2 cents, this is usually a rounding path issue rather than a missing payout.

4. Check for payouts that settled after the file cutoff. The payment provider file is cut at a fixed time, so late settlements can land in the next file even when the internal ledger already recorded them.

```bash
psql "$PAYOUTS_DB_URL" -c "
select payout_id, creator_id, amount_cents, currency, settled_at
from payout_settlements
where payout_month = date '2025-12-01'
  and settled_at >= timestamp '2025-12-15 06:00:00+00'
order by settled_at;"
```

If the rows are valid but landed after the cutoff, the mismatch is expected and the run should be retried against the next settlement file.

5. Check for manual adjustments that did not create a ledger entry. These usually come from a one-off correction that was applied to the provider side only.

```bash
psql "$PAYOUTS_DB_URL" -c "
select adjustment_id, payout_id, amount_cents, currency, created_by, created_at
from payout_adjustments
where payout_month = date '2025-12-01'
order by created_at desc;"
```

If an adjustment exists without a matching ledger row, that is the source of the mismatch and must be reversed or added to the ledger before the next run.

## Mitigation

1. If the mismatch is only a rounding difference and the totals are off by a cent or two, do not patch the database directly. Re-run the reconcile report and verify that the difference is stable across two runs.

```bash
payouts-admin reconcile --month 2025-12 --explain
```

2. If the difference is caused by a late settlement, wait for the next settlement file and then rerun the payout batch. Do not force the run before the file catches up.

```bash
kubectl -n payouts rollout restart deploy/payouts-worker
kubectl -n payouts logs deploy/payouts-worker --since=10m
```

3. If there is a manual adjustment without a ledger entry, add the missing ledger entry using the approved payouts process, then rerun reconcile. Keep the adjustment amount exact and preserve the original currency.

4. Once the difference is resolved, rerun the blocked batch and confirm that the reconcile output is clean.

```bash
payouts-admin reconcile --month 2025-12 --explain
kubectl -n payouts get jobs | grep 2025-12
```

## Escalation

Escalate to `nd` and `jh` in `#oncall-payouts` if any of the following are true:

- the mismatch persists after a second reconcile run,
- the difference is larger than 2 cents in a single currency,
- the settlement file appears incomplete,
- the ledger and settlement totals disagree for more than one currency,
- you find a manual adjustment that cannot be matched to an approved internal change.

If the issue looks like corrupted data or an unexpected provider file format, open a `PAY-` ticket and include the reconcile output, the affected payout month, the settlement cutoff time, and the list of payout IDs from `--explain`.

## Common causes

- Rounding in one currency, usually a one cent delta.
- A payout settled after the file cutoff, so the internal ledger and the file belong to different runs.
- A manual adjustment without a corresponding ledger entry.

## History

- 2025-12-18, v1, initial runbook for payout ledger mismatch diagnosis and reconciliation.
