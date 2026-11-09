---
id: wiki-export-2024/Upload_Limits.md
source: wiki-export-2024
type: wiki
title: "Upload Limits"
url: https://wiki.castlane.internal/display/ENG/Upload+Limits
service: [upload-api]
allowed_groups: [eng]
author: lm
version: 1
effective_at: 2024-04-30
superseded_by: null
is_current: true   # frozen on 2024-09-30 with the rest of the export
deleted_at: null
exported_at: 2024-09-30T12:00:00Z
updated_at: 2024-04-30T14:31:00Z
generated: true
---
# Upload Limits

Engineering / Media / Upload API

Created by lm, last modified on Apr 30, 2024 (version 7)

This page collects the current upload rules for creator support and for anyone debugging upload-api.

## What can be uploaded?

We accept audio files in these formats:

- MP3
- M4A
- AAC
- WAV
- FLAC

We also accept a few container variations if the audio stream is clearly supported by our transcoder, but the safest path is still one of the formats above.

Common error message:

> `unsupported file type, please upload an audio file`

## Maximum upload size

The maximum upload size is **1 GiB per episode file**.

If a creator tries to send something larger, upload-api rejects it before the file is queued for processing.

Example:

> `file too large, maximum allowed size is 1073741824 bytes`

Support note: if the creator is exporting from editing software, ask them to use a smaller bitrate or trim unnecessary silence at the end.

## Why do we reject video files?

We reject video files on purpose.

Castlane publishes podcast audio, not video. Video uploads create several problems:

- they are much larger than audio-only files
- they slow down upload-api and the transcoder queue
- they increase storage and transfer costs
- they often hide the actual audio track inside a video container, which is confusing for creators and for support

If the file is a video, creators should export audio only from their editor.

Example message:

> `video files are not supported, please upload audio only`

## FAQ for creator support

**Q: My upload failed right at the end. What should I check first?**  
A: File type and file size. Most failures are either a non-audio file or something over 1 GiB.

**Q: Can I upload a screen recording and have Castlane extract the audio?**  
A: No. Please export the audio track separately.

**Q: Why does my WAV work in one editor but fail here?**  
A: Some WAV files contain unusual codecs or metadata. If that happens, ask the creator to re-export as MP3 or M4A.

**Q: What should I tell creators who want the best compatibility?**  
A: MP3 at a normal podcast bitrate is the simplest option. M4A is also fine.

**Q: Does upload-api keep retrying a bad file?**  
A: No. The creator needs to fix the file and upload again.

Labels: upload-api, creator-support, limits

Comments (2)

- lm: Added the accepted formats list so support can paste one answer instead of sending three links.
- tw: Please keep the error examples, they help a lot in Slack when people ask what "failed" means.
