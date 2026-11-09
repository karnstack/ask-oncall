---
id: wiki-export-2024/Deploy_Freeze_Policy.md
source: wiki-export-2024
type: wiki
title: "Deploy Freeze Policy"
url: https://wiki.castlane.internal/display/ENG/Deploy+Freeze+Policy
service: [platform]
allowed_groups: [eng]
author: hq
version: 1
effective_at: 2024-09-02
superseded_by: null
is_current: true   # frozen on 2024-09-30 with the rest of the export
deleted_at: null
exported_at: 2024-09-30T12:00:00Z
updated_at: 2024-09-02T13:20:00Z
generated: true
---
# Deploy Freeze Policy

Engineering / Platform / Deploy Freeze Policy

Created by hq, last modified on Sep 02, 2024 (version 7)

Use this page to check whether a deploy is allowed.

## Freeze windows

- No deploys from **15:00 UTC Friday** until **Monday 00:00 UTC**
- No deploys during the payout run on the **15th**, from **06:00 UTC to 08:00 UTC**
- No deploys in the **last two weeks of December**, except fixes approved in **#platform**

## What counts as a deploy

- Kubernetes manifests
- App releases
- Config changes that roll pods
- Flag changes that alter live behaviour
- Database migrations

## Before you deploy

- Check the calendar first
- Confirm the current UTC time
- Ask in **#platform** if the window is unclear
- Make sure the change is small enough to roll back cleanly
- Use staging first when possible

**Do not assume a quiet cluster means it is safe to deploy.**

## Exceptions

- Emergency fixes only
- Approval must be visible in **#platform**
- Link the approval in the deploy thread
- Keep the scope to the issue at hand

**Do not widen the change while the freeze is active.**

## If you are on call

- Say why the deploy is needed
- Say what breaks if you wait
- Say how you will roll back
- Post the deploy ticket in **#platform**

**If the change touches payouts, feeds, or media ingest, double check the freeze window before you start.**

## Notes

- Weekend deploys are rare
- Friday deploys after 15:00 UTC are blocked unless specifically approved
- December freezes apply even if the branch is ready
- Use judgment, but do not guess

Labels: platform, deploys, policy

Comments (2)

hq: Keep this pinned in #platform for quick checks.

ne: Added the December rule after the year-end incident review.
