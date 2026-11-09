---
id: runbooks/payouts-rerun-one.md@v2
source: runbooks
type: runbook
title: "Rerun one creator's payout"
url: https://runbooks.castlane.internal/payouts-rerun-one/v2
service: [payouts, payouts-worker]
scope: payouts
allowed_groups: [eng]
author: jh
version: 2
effective_at: 2025-07-15
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-07-15T10:59:00Z
generated: true
---
# Rerun one creator's payout

This runbook covers a single creator payout that failed after the monthly batch completed. It applies to the `payouts` and `payouts-worker` services in the `payouts` namespace, and the owner team is `payouts-eng`. Use it when the batch finished normally, but one creator needs a safe rerun for a specific month.

## Diagnosis

1. Confirm the payout batch completed and identify the failed creator-month pair.

```bash
kubectl -n payouts get pods
kubectl -n payouts logs deploy/payouts-worker --since=24h | grep -E 'batch|payout_id|failed|creator_id'
```

Look for the exact `creator_id`, the payout month, and the payout row or job identifier. If the batch is still running, stop here and treat it as a batch incident instead.

2. Check the ledger entry first. We only rerun if the ledger is consistent and the failure is limited to this payout row.

```bash
psql "postgres://payouts@pg-payouts/payouts" -c "
select
  payout_id,
  creator_id,
  payout_month,
  status,
  ledger_entry_id,
  updated_at
from payouts
where creator_id = '<creator_id>'
  and payout_month = '2026-09'
order by updated_at desc;
"
```

Then inspect the ledger record tied to that payout.

```bash
psql "postgres://payouts@pg-payouts/payouts" -c "
select
  id,
  payout_id,
  creator_id,
  amount_cents,
  currency,
  status,
  posted_at
from payout_ledger
where creator_id = '<creator_id>'
  and payout_month = '2026-09'
order by posted_at desc;
"
```

You want to see a single ledger entry with the expected amount and a payout row that failed after the batch. If the ledger entry is missing, duplicated, or the amounts do not match, do not rerun yet.

3. Verify there is no wider queue or worker issue that would make the rerun unsafe.

```bash
kubectl -n payouts get deploy,pod
kubectl -n payouts describe deploy/payouts-worker | sed -n '/Events:/,$p'
kubectl -n payouts logs deploy/payouts --since=24h | tail -n 50
```

If you see multiple failures, DB connectivity errors, or pod instability, escalate before changing anything.

## Mitigation

1. Post the rerun command in `#oncall-payouts` and wait for a `+1`. This is the two-person rule. Do not run the command until another on-call person explicitly approves it.

Example Slack message:

```text
Rerun request for creator payout, after batch. Creator <creator_id>, month 2026-09. Ledger entry checked, payout row failed once, no hand edits planned. Command:
payouts-admin rerun --creator <creator_id> --month 2026-09
Please +1 if this looks good.
```

2. Run the rerun only after the `+1`.

```bash
payouts-admin rerun --creator <creator_id> --month 2026-09
```

This command is idempotent by `payout_id` for the creator and month. Do not retry it repeatedly without checking the result, because repeated reruns should not create duplicate payouts, but they can still complicate debugging.

3. Confirm the payout moved to a terminal success state and that no duplicate ledger activity appeared.

```bash
psql "postgres://payouts@pg-payouts/payouts" -c "
select
  payout_id,
  creator_id,
  payout_month,
  status,
  updated_at
from payouts
where creator_id = '<creator_id>'
  and payout_month = '2026-09'
order by updated_at desc;
"
```

```bash
psql "postgres://payouts@pg-payouts/payouts" -c "
select
  count(*) as ledger_rows
from payout_ledger
where creator_id = '<creator_id>'
  and payout_month = '2026-09';
"
```

If the row is still failing, capture the current status and logs before any second attempt. Do not edit payout rows by hand.

## Escalation

Escalate to `payouts-eng` and `mbe` if any of the following are true:

- the ledger entry is missing or inconsistent
- the rerun returns a database or worker error
- more than one payout row for the same creator and month looks affected
- the payout remains failed after a clean rerun
- you suspect a broader issue in `payouts-worker` or the payment provider integration

Useful evidence to attach:

```bash
kubectl -n payouts logs deploy/payouts-worker --since=6h | tail -n 200
kubectl -n payouts get pods -o wide
psql "postgres://payouts@pg-payouts/payouts" -c "
select *
from payouts
where creator_id = '<creator_id>'
  and payout_month = '2026-09';
"
```

If this turns into a larger batch problem, follow the batch incident path instead of continuing with one-off reruns.

## Settings

| Item | Value |
| --- | --- |
| Service | `payouts`, `payouts-worker` |
| Namespace | `payouts` |
| Command | `payouts-admin rerun --creator <creator_id> --month 2026-09` |
| Safety check | Check the ledger entry first |
| Approval | Post in `#oncall-payouts` and wait for `+1` |
| Editing policy | Never edit payout rows by hand |

## History

- 2025-06-10, version 1, added the first safe rerun flow for a single creator after batch completion, with ledger-first checks.
- 2025-06-24, version 1.1, added the two-person rule and clarified that payout rows must never be edited by hand.
- 2025-07-15, version 2, tightened the verification steps, added explicit idempotent rerun guidance, and expanded escalation criteria.
