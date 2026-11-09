---
id: handbook/oncall-handbook.md@v6
source: handbook
type: handbook
title: On-call handbook
url: https://runbooks.castlane.internal/handbook/v6
service: []
allowed_groups: [eng, contractors]
author: dara
version: 6
effective_at: 2026-10-30
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-10-30T09:00:00Z
---

# On-call handbook

Read this before your first shift. It is short on purpose. Everything
service-specific is in the runbooks.

## The rotation

- 18 people: 15 employees and 3 contractors from our agency partner. One
  week at a time, Monday 10:00 UTC to Monday 10:00 UTC.
- Each week has a primary and a secondary. The secondary is always an
  employee.
- Hand-off is a short post in `#oncall` on Monday: open incidents, silences
  that are still active, anything odd. Template at the end.
- The platform rotation covers upload-api, transcoder, feed-builder,
  cdn-edge, private-feeds, PgBouncer, Postgres and Redis in both clusters
  (`prod-us-east`, `prod-eu-west`).
- Payouts has its own rotation, `payouts-eng` only. If a payouts alert pages
  you by mistake, hand it to `#oncall-payouts`.
- Security is not paged through this rotation. Anything that involves a
  token, a password, a key or personal data in the wrong place: page
  security directly with `/page security` and stop.

## Who can read what

| Group | Who | Can read |
|---|---|---|
| `everyone` | every account | status page, vendored Kubernetes and Postgres docs |
| `eng` | every employee in engineering | runbooks, postmortems, ADRs, incident channels, this handbook |
| `contractors` | the 3 agency engineers on the rotation | runbooks, this handbook, vendored docs |
| `security` | the security team | everything in `eng`, plus security postmortems and restricted incident channels |
| `payouts-eng` | the payouts team | everything in `eng`, plus payout run reports and payouts postmortems |

Contractors: postmortems and incident channels are employees only. If a
runbook points you to a postmortem, ask your secondary.

## When you get paged

1. Acknowledge within 5 minutes.
2. Open an incident with `/incident` in Slack. incident-bot creates
   `#inc-NNNN` and posts the alert. Since 2026-10-01 every page opens an
   INC, even a sev4, so the numbers climb faster than they used to.
3. Find the runbook. Every Castlane alert and every kube-prometheus alert
   links to one. Castlane's own alerts are `PgBouncerPoolSaturated`,
   `FeedBuildLagHigh`, `TranscodeQueueBacklog` and `PayoutBatchLate`. The
   rest (`KubePodCrashLooping`, `KubeHpaMaxedOut` and friends) link to the
   upstream runbooks we vendor, and most have a Castlane page too.
4. Write what you do in the incident channel as you do it, commands
   included. The next person paged for the same thing will read it.
5. Ask for help early. Pulling in the secondary at minute 5 is normal.

Severities: sev1 (creators or listeners broadly affected, page the
secondary and the engineering manager), sev2 (one feature down or one
region), sev3 (degraded, no visible impact yet), sev4 (noise, fix the alert).

## Tools

- `kubectl`, contexts `prod-us-east` and `prod-eu-west`.
- `flagctl` for runtime flags (`flagctl get`, `flagctl set <flag> <value> --reason "INC-NNNN ..."`).
  Flags you may need at night: `feeds.writes_paused`, `payouts.writes_paused`,
  `payouts.batch_enabled` (payouts-eng only).
- `amtool silence add` for silences. Always with `-d` and a comment naming the INC.
- Grafana: https://grafana.castlane.internal

## Runbooks and versions

Runbooks live in the registry at runbooks.castlane.internal. Each runbook
shows its version and effective date at the top. Since 2026-03, when a
postmortem changes a runbook, the old version stays published, marked as
superseded, so links from old postmortems still work. Always check you are
on the current version (the registry shows a banner on old ones; links in
Slack go to whatever version they were pasted from).

Old wiki pages (the 2024 export) are kept for history. Do not follow them
during an incident.

## #ask-oncall

`#ask-oncall` answers questions from the runbooks, postmortems, incident
channels, ADRs, this handbook and the vendored Kubernetes and Postgres docs.
Mention `@ask-oncall` in any incident channel or ask in `#ask-oncall`.

- It cites every claim with a numbered source. Open the source before you
  paste a command.
- It is read-only. It never runs anything.
- If it says "Not found in Castlane's docs", believe it and ask a person.
- Its index is rebuilt nightly at 02:00 UTC for now. A fix posted in an
  incident channel tonight is not in it until tomorrow (INC-2291). Read the
  incident channel first. PLAT-4473 will make this minutes.
- Check the version and date next to each source. INC-2276 cost 4 minutes
  because it cited a deleted runbook.
- Wrong answer? React with `:x:` and say why in a reply. dara reads them.

## Hand-off template

```
On-call hand-off, week of <date>
Primary / secondary: <handle> / <handle>
Open incidents: <INC-NNNN, one line each>
Active silences: <matcher, expiry, why>
Odd things: <anything you would want to know>
```

## History

- v6 (2026-10-30): #ask-oncall section updated after INC-2291 and INC-2276.
- v5 (2026-10-01): every page opens an INC.
- v4 (2026-06-18): Patroni, links to failover v3.
- v3 (2026-03-02): superseded runbooks stay published.
