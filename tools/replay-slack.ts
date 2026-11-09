// Replay the #inc-2291 channel day (2026-10-26) at its real timestamps through
// the debounce rule, and count the re-embeds. No database, no API calls.
//   node tools/replay-slack.ts [--wait 60]
import { parseArgs } from "node:util";
import { countTokens, chunkByHeadings } from "../src/chunk.ts";
import { SLACK_DEBOUNCE_MS } from "../src/config.ts";
import { flattenSlack, loadCastlane } from "../src/corpus.ts";
import { debounceFires } from "../src/events.ts";

const { values } = parseArgs({ options: { wait: { type: "string", default: String(SLACK_DEBOUNCE_MS / 1000) }, day: { type: "string", default: "slack/inc-2291/2026-10-26.json" } } });
const day = loadCastlane().find((d) => d.id === values.day)!;
const hh = (t: number) => new Date(t * 1000).toISOString().slice(11, 19);
const events = day.messages!.flatMap((m) => [m, ...(m.replies ?? [])]).map((m) => ({ key: day.id, t: Number(m.ts) }));

// the document as it stood at time t, and what re-embedding it then costs
const tokensAt = (t: number) => {
  const kept = day.messages!.filter((m) => Number(m.ts) <= t).map((m) => ({ ...m, replies: (m.replies ?? []).filter((r) => Number(r.ts) <= t) }));
  return chunkByHeadings({ ...day, text: flattenSlack(day.title, kept) }).reduce((s, c) => s + countTokens(c.body), 0);
};
const every = events.map((e) => ({ key: e.key, t: e.t }));
const debounced = debounceFires(events, Number(values.wait));
const cost = (fires: { t: number }[]) => fires.reduce((s, f) => s + tokensAt(f.t), 0);
const longestWait = Math.max(...events.map((e) => (debounced.find((f) => f.t >= e.t)?.t ?? e.t) - e.t));

console.log(`${day.title}: ${events.length} messages, ${hh(events[0].t)} to ${hh(events.at(-1)!.t)}`);
console.log(`re-index on every message:   ${every.length} re-embeds, ${cost(every)} tokens, $${((cost(every) * 0.02) / 1e6).toFixed(5)}`);
console.log(`${values.wait} s debounce per document: ${debounced.length} re-embeds, ${cost(debounced)} tokens, $${((cost(debounced) * 0.02) / 1e6).toFixed(5)}, longest wait ${longestWait.toFixed(0)} s`);
const fix = day.messages!.find((m) => m.text.startsWith("WORKAROUND"));
if (fix) console.log(`the ${hh(Number(fix.ts))} workaround is searchable at ${hh(debounced.find((f) => f.t >= Number(fix.ts))!.t)}`);
