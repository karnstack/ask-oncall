---
id: adr/ADR-0036-every-page-an-incident.md
source: adr
type: adr
title: "ADR-0036: Every page opens an incident"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0036-every-page-an-incident.md
service: [platform]
allowed_groups: [eng]
author: rs
version: 1
effective_at: 2026-09-24
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-09-24T16:37:00Z
generated: true
---
# ADR-0036: Every page opens an incident
Status: Accepted, Date 2026-09-24, Deciders: rs, dara, ne

## Context

Until now, some pages were handled only in Slack. That created two problems:

- There was no durable record of what happened, what was checked, or what was fixed.
- There was no incident channel to review later, which made handoffs, follow-up, and postmortems noisy and incomplete.

This was especially bad for repeated alerts in platform services, where the same issue could page multiple times across a week and each response lived only in ad hoc chat. We also want less ambiguity between "handled in chat" and "tracked as an incident".

Dashboard for the current page load and alert volume: https://grafana.castlane.internal/d/platform-alerts

Useful checks before and after rollout:

- Alert rate by service:
  `sum by (alertname, service) (increase(ALERTS{alertstate="firing"}[1h]))`
- Paging volume by severity:
  `sum by (severity) (increase(alertmanager_notifications_total[1h]))`
- Incident creation lag, if exposed by the bot:
  `max_over_time(incident_bot_create_latency_seconds[30m])`

## Decision

From 2026-10-01, every page opens an incident through incident-bot. Sev4 is allowed and expected for low-severity pages. The oncall flow becomes:

1. Alert fires.
2. Oncaller acknowledges in Slack.
3. incident-bot opens an INC automatically, or the oncaller creates one immediately if the automation misses.
4. The incident channel becomes the source of record for investigation, timeline, and follow-up.

Implementation details:

- All paging alerts in platform must route through incident-bot.
- Pages without an open incident are considered incomplete handling.
- Sev4 incidents are acceptable for noise, transient failures, and single-pod issues that still need tracking.
- If a page is truly noise, the action item is to fix the alert or the underlying condition, not to ignore future pages.

Operational checklist:

- Confirm every page has an INC before closing work.
- Add the INC number to the Slack thread.
- Use the incident channel for notes, timestamps, and commands.
- Link the dashboard in the first update.

## Consequences

Good:

- Every page has a durable audit trail.
- Handoffs are easier because the incident channel exists from the start.
- Repeated pages are easier to spot and trend.
- Postmortems have a complete timeline instead of scattered Slack history.

Bad:

- INC numbers will rise about three times faster.
- Some low-severity pages will now create extra process overhead.
- The team must keep the incident channel up to date, or the value drops fast.
- Oncall work becomes slightly more ritualised, especially for sev4.

Expected operating pattern after rollout:

- More small incidents, fewer lost pages.
- Better follow-up on noisy alerts.
- Less tolerance for "we saw it in Slack and forgot it".

## Alternatives considered

1. **Keep handling some pages in Slack only**  
   Rejected because it preserves the same record-keeping gap and makes later review unreliable.

2. **Create incidents only for sev1 to sev3 pages**  
   Rejected because sev4 pages are often the ones that get ignored, then repeat. We want the record even when urgency is low.

3. **Auto-create incidents only after a page has repeated twice**  
   Rejected because it delays the record until after extra noise has already happened, and it still leaves the first response uncaptured.
