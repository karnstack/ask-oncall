---
id: adr/ADR-0035-flagctl.md
source: adr
type: adr
title: "ADR-0035: Runtime flags with flagctl"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0035-flagctl.md
service: [platform]
allowed_groups: [eng]
author: dara
version: 1
effective_at: 2025-09-16
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-09-16T09:52:00Z
generated: true
---
# ADR-0035: Runtime flags with flagctl

Status: Accepted, Date 2025-09-16, Deciders: @dara, @ne, @tw

## Context

We need a way for operators to change a few high-risk behaviours at night without deploying new code. The main cases are pausing writes for feeds or payouts, turning payout batch processing on and off, and controlling ad stitching for specific shows. A deploy is too slow for these cases and creates extra risk when the only change needed is operational.

We already have a small internal flag service and a CLI, `flagctl`, so the decision was whether to standardise on that path or keep using deploy-time config. The goal is a simple, auditable switch that can be changed quickly, with a clear reason attached to every change and visibility in `#flags`.

## Decision

Castlane will use runtime flags managed through `flagctl` for operator-controlled toggles.

Flag names must use the `<area>.<name>` format. The initial set is:

- `feeds.writes_paused`
- `payouts.writes_paused`
- `payouts.batch_enabled`
- `ads.stitching_enabled`
- `ads.show.<show_id>`

Operators will read a value with:

```bash
flagctl get feeds.writes_paused
```

Operators will change a value with:

```bash
flagctl set feeds.writes_paused true --reason "feed builder is lagging and we need to stop new writes while draining the queue"
```

The CLI will reject any `set` call without `--reason`. Every successful change will be posted to `#flags` with the flag name, old value, new value, actor, timestamp, and reason. We will treat the flag service as the source of truth for these operational switches, and services will read values at runtime instead of only at startup.

We will keep the scope narrow. These flags are for operational control, not product experiments, not per-request routing, and not long-lived configuration that should live in code or config files.

## Consequences

Good:

- Operators can pause or resume sensitive work immediately, without waiting for a deploy.
- The `--reason` requirement creates a lightweight audit trail and makes later review easier.
- Posting every change to `#flags` keeps the whole on-call group aware of state changes.
- The naming convention makes flags easy to scan and reduces ambiguity across teams.

Bad:

- Runtime flags add another moving part that services must query and cache correctly.
- A bad flag value can affect production quickly, so we need careful review of flag semantics and defaults.
- The team now has to maintain the flag service and keep its permissions, alerting, and docs current.
- There is a risk of leaving a safety flag enabled longer than intended if we do not review active flags during incidents and post-incident cleanup.

## Alternatives considered

1. **Deploy-time environment variables**
   - Rejected because changing them requires a deploy, which is too slow for late-night operational response.

2. **Manual database updates**
   - Rejected because they are harder to audit consistently, easier to get wrong, and do not provide a single operator workflow or automatic `#flags` notification.

3. **Service-specific admin endpoints**
   - Rejected because each service would invent its own control surface, which fragments the operator experience and makes auditing inconsistent.
