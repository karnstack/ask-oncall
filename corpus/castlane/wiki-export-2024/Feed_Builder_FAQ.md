---
id: wiki-export-2024/Feed_Builder_FAQ.md
source: wiki-export-2024
type: wiki
title: "Feed Builder FAQ"
url: https://wiki.castlane.internal/display/ENG/Feed+Builder+FAQ
service: [feed-builder]
allowed_groups: [eng]
author: tw
version: 1
effective_at: 2024-01-22
superseded_by: null
is_current: true   # frozen on 2024-09-30 with the rest of the export
deleted_at: null
exported_at: 2024-09-30T12:00:00Z
updated_at: 2024-01-22T09:52:00Z
generated: true
---
# Feed Builder FAQ

Engineering / feeds / Feed Builder FAQ

Created by tw, last modified on Jan 24, 2024 (version 7)

## why is an episode not in the feed yet?

- check that upload-api finished the upload and the episode is marked published.
- check feed-builder logs for the show id and episode id.
- if the episode was edited after publish, wait for the rebuild to finish.
- if the show uses private feeds, make sure the subscriber token is still valid and the request is hitting private-feeds, not the public feed path.
- if support says "it is missing", ask whether the episode is missing from the rss xml or only from a podcast app. those are different problems.

## how long do podcast directories take to refresh?

- most podcast directories refresh on their own schedule, not ours.
- expect anything from a few minutes to a day.
- some podcast apps cache the feed aggressively and will not pull a fresh copy right away.
- if a creator says the rss is correct but the app is stale, tell them to refresh the show manually in the app if it supports that.
- do not keep rebuilding the feed just to force a directory refresh, that usually does not help.

## what does the feed's ttl element do?

- it tells podcast apps how long they may cache the feed before asking again.
- we set ttl in minutes.
- lower ttl can make apps check sooner, but it does not force every app to refetch.
- do not use ttl as a fix for missing episodes.
- if the ttl is changed, it takes effect on the next feed build.

## how do i force a rebuild?

- use feed-builder-admin.
- old admin page is gone, do not point people at it.
- find the show, open the rebuild action, and trigger a rebuild.
- if the queue is backed up, the rebuild waits behind other feed jobs.
- if the rebuild keeps failing, check the feed-builder deployment and the feed-rebuild queue before retrying.

## notes

- rebuilds are safe to repeat.
- if a creator reports the wrong episode order, rebuild the feed and check the episode timestamps first.
- if the feed looks stale in prod-eu-west, confirm the rebuild happened in prod-us-east first.

Labels: feeds, faq, support, feed-builder

Comments (2)

- zi: add a note about private feeds and tokenized urls, support keeps asking.
- tw: ok, keep it short.
