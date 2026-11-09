---
id: runbooks/alert-silences.md@v1
source: runbooks
type: runbook
title: "Alertmanager silences"
url: https://runbooks.castlane.internal/alert-silences/v1
service: [platform]
allowed_groups: [eng, contractors]
author: dara
version: 1
effective_at: 2025-11-04
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-11-04T15:38:00Z
generated: true
---
# Alertmanager silences

This runbook covers temporary Alertmanager silences for Castlane’s Kubernetes alerts. Use it when an alert is noisy, understood, and safe to mute for a bounded window while you fix the underlying issue. It applies to all namespaces in prod and staging, and it is owned by the platform team.

## Diagnosis

1. Confirm the alert is the one you actually want to suppress, and check the current firing scope.

   ```bash
   amtool --alertmanager-url=https://alertmanager.castlane.internal alert query --alertname KubePodCrashLooping
   ```

   If the alert is not clearly identified, do not create a silence yet. Silence the narrowest possible matcher set, because broad silences hide unrelated problems.

2. Inspect any existing silences for the same alert or namespace.

   ```bash
   amtool --alertmanager-url=https://alertmanager.castlane.internal silence query
   ```

   Look for overlapping silences that already cover the alert. If one exists and it is about to expire, it is usually better to let it run out than to add another overlapping silence.

3. Decide the matcher. Use one alert name when you only need to mute a single alert, or use a namespace matcher when the issue affects a whole workload.

   Example, one alert only:

   ```bash
   alertname=KubePodCrashLooping
   ```

   Example, one namespace:

   ```bash
   namespace=media
   ```

   Do not silence `Watchdog` or `InfoInhibitor`. Those alerts protect alerting health and silence logic, and muting them can hide a broken monitoring path.

4. Check the duration and whether you need a ticket. Every silence must include `-d` with a duration and `-c` with the INC number in the comment. Any silence longer than 24 hours needs a ticket before you create it.

   Example comment format:

   ```bash
   -c "INC-1234, suppressing crashloop alerts while roll out completes"
   ```

## Mitigation

1. Create the silence with the smallest useful matcher set.

   Example, mute one alert for two hours:

   ```bash
   amtool --alertmanager-url=https://alertmanager.castlane.internal silence add \
     alertname=KubePodCrashLooping \
     -d 2h \
     -c "INC-1234, temporary mute while pods restart"
   ```

   Example, mute one namespace for 45 minutes:

   ```bash
   amtool --alertmanager-url=https://alertmanager.castlane.internal silence add \
     namespace=feeds \
     -d 45m \
     -c "INC-1234, feed rebuild is in progress"
   ```

2. Verify the silence was created and note the silence ID for later cleanup.

   ```bash
   amtool --alertmanager-url=https://alertmanager.castlane.internal silence query
   ```

   Record the silence ID in the incident channel and in the incident ticket if one exists.

3. If the issue is resolved early, expire the silence immediately instead of waiting for it to time out.

   ```bash
   amtool --alertmanager-url=https://alertmanager.castlane.internal silence expire <silence-id>
   ```

   This keeps the alert stream honest and reduces the chance that a later incident is missed because a stale silence was left behind.

## Escalation

Escalate to `#platform` or the incident channel if you need a silence longer than 24 hours, if the matching scope is unclear, or if the alert is firing for multiple services and you cannot isolate the cause. If a silence would cover `Watchdog`, `InfoInhibitor`, or anything that looks like a monitoring failure, stop and ask for review before creating it.

If the alert noise is coming from a real outage rather than a known maintenance window, do not silence first. Work the incident, then add a narrow silence only if it reduces duplicate pages while you are actively mitigating the root cause.

## Rules of thumb

- Always use `-d` with a concrete duration.
- Always use `-c` with the INC number.
- Prefer one alert matcher over a namespace matcher.
- Never silence `Watchdog` or `InfoInhibitor`.
- If the silence needs more than 24 hours, create or link a ticket first.
- Remove the silence as soon as the noisy condition is gone.

## History

- 2025-11-04, version 1, initial runbook for creating, listing, and expiring Alertmanager silences.
- 2025-11-04, version 1, added matcher examples for a single alert and a single namespace.
- 2025-11-04, version 1, clarified that silences over 24 hours require a ticket and that `Watchdog` and `InfoInhibitor` must never be silenced.
