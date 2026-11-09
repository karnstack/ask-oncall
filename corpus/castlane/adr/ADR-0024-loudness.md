---
id: adr/ADR-0024-loudness.md
source: adr
type: adr
title: "ADR-0024: Normalise episode loudness to -16 LUFS"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0024-loudness.md
service: [transcoder]
allowed_groups: [eng]
author: pk
version: 1
effective_at: 2024-09-10
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2024-09-10T10:59:00Z
generated: true
---
# ADR-0024: Normalise episode loudness to -16 LUFS
Status: Accepted, Date 2024-09-10, Deciders: pk, lm, vi

## Context

Listeners have been complaining that volume jumps between shows are too large. The common pattern is that one podcast is mastered loudly, another is much quieter, and the playback experience on podcast apps becomes annoying when people move between feeds.

We already run transcoding in `transcoder`, so this is the right place to enforce a house loudness target before the audio is published. The goal is to make output consistent without damaging the original upload. We also need to keep the original master around so we can re-transcode later if the target changes or if we need to regenerate files for a specific codec profile.

The current pipeline already extracts audio, normalises container metadata, and writes the final deliverables. Loudness normalisation fits naturally into that flow, but it must be deterministic and safe for long-form spoken word. We want a target that is close to common podcast practice, with enough headroom to avoid clipping on peaks.

## Decision

`transcoder` will normalise episode audio to an integrated loudness of `-16 LUFS` with a true peak ceiling of `-1 dBTP`.

We will do this with `ffmpeg` in two passes, using `loudnorm` in analysis mode first, then render mode with the measured values. The first pass collects the input stats, the second pass applies the correction.

Example:

```bash
ffmpeg -i input.wav -af loudnorm=I=-16:TP=-1:LRA=11:print_format=json -f null -
```

Then apply the measured values from the first pass:

```bash
ffmpeg -i input.wav -af loudnorm=I=-16:TP=-1:LRA=11:measured_I=-18.2:measured_TP=-2.4:measured_LRA=8.1:measured_thresh=-28.3:offset=2.2:linear=true:print_format=summary output.flac
```

We will store the uploaded master separately from the transcoded output. The master stays immutable in object storage and is the source for any future re-transcode. The normalised output is what gets published to the CDN and downstream feed generation.

We will keep the existing transcoder job structure, but add a loudness analysis stage before the encode stage for all spoken-word episodes.

## Consequences

Good: listeners get a much more consistent playback experience across shows and episodes. Quiet shows become audible without forcing users to adjust device volume every time.

Good: true peak limiting at `-1 dBTP` gives us a safety margin against inter-sample clipping and bad encoder overs.

Good: keeping the original master means we can reprocess files if we later change codec settings or decide to revise the target loudness.

Bad: two-pass processing adds CPU time and increases queue latency in `transcoder`, especially for long episodes.

Bad: some creators may dislike the sound of normalised audio if they were intentionally using dynamics for effect, although for most spoken-word content the tradeoff is acceptable.

Bad: storage usage increases because we retain both the original master and the published derivative.

## Alternatives considered

1. Normalize only on playback in the client. Rejected because Castlane does not control every podcast app, and the listener experience would vary across clients.

2. Use a single-pass loudness filter. Rejected because we want accurate integrated loudness and peak control, and single-pass tuning is less predictable on long-form audio.

3. Leave audio untouched and rely on creator mastering. Rejected because the complaint is widespread and we cannot depend on consistent upstream production standards.
