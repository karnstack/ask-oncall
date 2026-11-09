// Index from events instead of a nightly job. Slack posts a message event;
// we store the message, and once its channel day has been quiet for
// SLACK_DEBOUNCE_MS we rebuild that day's document and sync it, the same
// sync() the nightly job uses. A burst of 37 messages becomes 20 re-embeds,
// and a message posted at 03:31 is searchable at about 03:32.
import { SLACK_DEBOUNCE_MS } from "./config.ts";
import { flattenSlack, loadCastlane, type Doc, type Msg } from "./corpus.ts";
import { pool } from "./db.ts";
import { syncDocuments } from "./sync.ts";

// ---- debounce -----------------------------------------------------------------

// Fire `onFire(key)` once a key has had no new event for `waitMs`.
export class Debouncer {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private waitMs: number;
  private onFire: (key: string) => unknown;
  constructor(waitMs: number, onFire: (key: string) => unknown) {
    this.waitMs = waitMs;
    this.onFire = onFire;
  }
  push(key: string) {
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      this.onFire(key);
    }, this.waitMs));
  }
  get pending() {
    return this.timers.size;
  }
}

// The same rule replayed over timestamps (seconds), for counting re-embeds.
export function debounceFires(events: { key: string; t: number }[], waitSec: number): { key: string; t: number }[] {
  const fires: { key: string; t: number }[] = [];
  const pending = new Map<string, number>();
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    for (const [k, last] of pending) if (e.t - last >= waitSec) { fires.push({ key: k, t: last + waitSec }); pending.delete(k); }
    pending.set(e.key, e.t);
  }
  for (const [k, last] of pending) fires.push({ key: k, t: last + waitSec });
  return fires;
}

// ---- Slack channel days ----------------------------------------------------------

export type SlackMessageEvent = { type: "message"; channel: string; user: string; text: string; ts: string; thread_ts?: string };

type Channel = { name: string; title: string; url: string; allowedGroups: string[] };

// Channel ids, names and who may read them, from the exported Slack days.
let channels: Map<string, Channel> | undefined;
function channelDirectory() {
  if (channels) return channels;
  channels = new Map();
  for (const d of loadCastlane().filter((d) => d.source === "slack")) {
    const channelId = d.url.split("/archives/")[1]?.split("/")[0];
    if (channelId) channels.set(channelId, { name: d.id.split("/")[1], title: d.title, url: d.url, allowedGroups: d.meta.allowedGroups });
  }
  return channels;
}

const day = (ts: string) => new Date(Number(ts.split(".")[0]) * 1000).toISOString().slice(0, 10);
export const slackDayId = (channelName: string, ts: string) => `slack/${channelName}/${day(ts)}.json`;

// A channel day = the exported messages (if any) plus every stored message.
export async function slackDay(docId: string, exported = loadCastlane().filter((d) => d.source === "slack")): Promise<Doc | null> {
  const [, name, file] = docId.split("/");
  const date = file.replace(/\.json$/, "");
  const entry = [...channelDirectory()].find(([, c]) => c.name === name);
  const base = exported.find((d) => d.id === docId);
  if (!entry && !base) return null;
  const from = Date.parse(`${date}T00:00:00Z`) / 1000;
  const stored = entry
    ? (await pool.query(
        `select ts, thread_ts, user_handle, text from slack_messages where channel_id = $1 and ts::numeric >= $2 and ts::numeric < $3 order by ts::numeric`,
        [entry[0], from, from + 86_400],
      )).rows
    : [];
  if (base && !stored.length) return base; // the export as it is
  const byTs = new Map<string, Msg>((base?.messages ?? []).map((m) => [m.ts, { ...m, replies: [...(m.replies ?? [])] }]));
  for (const r of stored) {
    const msg: Msg = { ts: r.ts, user: r.user_handle, text: r.text };
    if (r.thread_ts && r.thread_ts !== r.ts) {
      const parent = byTs.get(r.thread_ts);
      if (parent && !parent.replies!.some((x) => x.ts === r.ts)) parent.replies!.push(msg);
    } else if (!byTs.has(r.ts)) byTs.set(r.ts, { ...msg, replies: [] });
  }
  const messages = [...byTs.values()].sort((a, b) => Number(a.ts) - Number(b.ts));
  if (!messages.length) return null;
  const channel = entry?.[1];
  const title = base?.title ?? `#${name} ${date}`;
  const last = messages.flatMap((m) => [m.ts, ...(m.replies ?? []).map((r) => r.ts)]).sort().at(-1)!;
  const updatedAt = new Date(Number(last.split(".")[0]) * 1000).toISOString();
  const meta = base
    ? { ...base.meta, updatedAt }
    : { type: "slack", service: [], scope: null, allowedGroups: channel!.allowedGroups, author: null, version: 1,
        effectiveAt: date, supersededBy: null, isCurrent: true, deletedAt: null, updatedAt };
  return { id: docId, source: "slack", title, url: base?.url ?? channel!.url, text: flattenSlack(title, messages), messages, meta };
}

// The Slack source as the nightly job lists it: the export, plus every day
// that has stored messages, so reconcile does not tombstone a live day.
export async function slackSource(exported: Doc[]): Promise<Doc[]> {
  const dir = channelDirectory();
  const { rows } = await pool.query(`select distinct channel_id, ts from slack_messages`);
  const ids = new Set(exported.map((d) => d.id));
  for (const r of rows) {
    const c = dir.get(r.channel_id);
    if (c) ids.add(slackDayId(c.name, r.ts));
  }
  const days = await Promise.all([...ids].map((id) => slackDay(id, exported)));
  return days.filter((d): d is Doc => d != null);
}

export async function reindexSlackDay(docId: string) {
  const doc = await slackDay(docId);
  if (!doc) return;
  return syncDocuments([doc]);
}

const debouncer = new Debouncer(SLACK_DEBOUNCE_MS, (docId) => reindexSlackDay(docId).catch((e) => console.error(`reindex ${docId}:`, e)));

export async function handleSlackMessage(e: SlackMessageEvent) {
  const channel = channelDirectory().get(e.channel);
  if (!channel) return; // a channel we do not index
  await pool.query(
    `insert into slack_messages (channel_id, ts, thread_ts, user_handle, text) values ($1, $2, $3, $4, $5)
     on conflict (channel_id, ts) do update set text = excluded.text`,
    [e.channel, e.ts, e.thread_ts ?? null, e.user, e.text],
  );
  debouncer.push(slackDayId(channel.name, e.thread_ts ?? e.ts));
}
