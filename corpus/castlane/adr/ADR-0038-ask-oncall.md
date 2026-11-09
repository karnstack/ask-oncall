---
id: adr/ADR-0038-ask-oncall.md
source: adr
type: adr
title: "ADR-0038: #ask-oncall, a read-only assistant that answers from our docs"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0038-ask-oncall.md
service: [ask-oncall]
allowed_groups: [eng]
author: dara
version: 1
effective_at: 2026-04-28
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-08-20T11:30:00Z
---

# ADR-0038: #ask-oncall, a read-only assistant that answers from our docs

Status: accepted (pilot). Date: 2026-04-28. Deciders: dara, rs, tw.

## Context

During incidents people search the runbook registry, the old wiki export,
postmortems and Slack, and the pages often disagree. In INC-2112 (2026-04-14, 03:12) the
on-call engineer spent eleven minutes on three pages about the transcoder
memory limit that said 2Gi, 3Gi and 4Gi. The right page was the runbook, and
it was the last one they opened.

## Decision

Build a small assistant in Slack, `#ask-oncall` plus an `@ask-oncall`
mention in incident channels.

- It answers only from Castlane's documents and the vendored Kubernetes and
  Postgres docs, and cites every claim with a numbered source.
- It never suggests a command that is not in a cited source.
- When nothing relevant is found it says "Not found in Castlane's docs" and
  lists the three nearest titles.
- It is read-only. No tools, no commands, no tickets. It cannot restart a pod.
- Postgres with pgvector holds the index, in our existing platform cluster.
  No new vendor.
- Pilot: one nightly job at 02:00 UTC re-reads every source. We will see how
  far that gets us before building anything cleverer.

## Consequences

- Answers are only as current as last night's index. To be revisited after
  the pilot.
- The index contains restricted documents (security and payouts
  postmortems). For the pilot only engineers can use the bot. Permissions in
  search are a follow-up before contractors get access.
- We need a way to know whether answers are good. A fixed set of questions
  with known answers, rerun on every change.

## Update, 2026-08-20

Opened to the whole on-call rotation, contractors included, because they
asked for it and they are on call at night like everyone else. The
permissions follow-up (PLAT-4290, filter search by the asker's groups) is
still open. Until it lands, do not ask about restricted incidents in
`#ask-oncall`.
