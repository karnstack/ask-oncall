---
id: wiki-export-2024/Transcoder_Restarts.md
source: wiki-export-2024
type: wiki
title: Transcoder Restarts
url: https://wiki.castlane.internal/display/ENG/Transcoder+Restarts
service: [transcoder]
allowed_groups: [eng]
author: pk
version: 4
effective_at: 2023-11-08
superseded_by: null
is_current: true   # frozen on 2024-09-30 with the rest of the export
deleted_at: null
exported_at: 2024-09-30T12:00:00Z
updated_at: 2023-11-08T13:05:00Z
---

# Transcoder Restarts

Engineering / Media / Transcoder Restarts

Created by pk, last modified on Nov 08, 2023 (version 4)

If transcoder pods keep restarting (CrashLoopBackOff), it is almost always
memory. The pods have 2Gi and ffmpeg sometimes wants more on big files.

Quick fix:

1. Find the pod: `kubectl -n media get pods | grep transcoder`
2. Delete it: `kubectl -n media delete pod <pod>`
3. It comes back and picks up the next job. The big job goes back to the
   queue after 10 minutes and usually works on the second try.

If it keeps happening, raise the memory limit in the deployment (it is 2Gi)
and tell the media team.

Do not restart Redis to "clear the queue". That loses jobs.

Labels: transcoder, media, crashloop

Comments (1)

rs, Feb 2, 2024: deleting the pod doesn't help if the same job is first in the queue again, it just dies again.
