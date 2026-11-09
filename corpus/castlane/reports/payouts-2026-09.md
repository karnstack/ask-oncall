---
id: reports/payouts-2026-09.md
source: reports
type: report
title: Payout run summary, September 2026
url: https://wiki.castlane.internal/payouts/runs/2026-09
service: [payouts, payouts-worker, pg-payouts]
alerts: [PayoutBatchLate]
allowed_groups: [payouts-eng]
author: jh
version: 1
effective_at: 2026-09-16
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-09-16T09:20:00Z
---

# Payout run summary, September 2026

Run date: Tuesday 2026-09-15. Owner this month: jh. Reviewer: cv.

## Numbers

| | September | August |
|---|---|---|
| Creators paid | 48,210 | 47,388 |
| Batch start (UTC) | 12:05 | 06:00 |
| Batch end (UTC) | 12:41 | 06:37 |
| Failed payouts, retried same day | 37 | 52 |
| Failed payouts, still open | 3 | 1 |
| Ledger difference after reconcile | 0.00 | 0.00 |

## What was different this month

The batch was held from 06:00 to 12:05 UTC at the security team's request,
linked to INC-2207. We set `payouts.batch_enabled` to false at 05:34 and back
to true at 12:02. `PayoutBatchLate` fired at 08:00 and was acknowledged as
expected. Creators got their money about six hours later than usual, the
same day.

Support received 112 tickets about the delay, mostly from creators in
time zones where 06:00 UTC is already the working day. Support used the
status page text; no further details were shared.

The batch itself ran normally once released: 36 minutes, inside the usual
range.

## Open items

- 3 payouts still failing: two closed bank accounts, one name mismatch.
  Creators contacted by support (PAY-1207, PAY-1208, PAY-1209).
- PAY-1211: when the batch is held on purpose, `PayoutBatchLate` should not
  page. Proposal: a silence created automatically when `payouts.batch_enabled`
  is set to false with a reason.
