// Index age per source: the newest document in the source against the newest
// one in the index. A sync that silently stopped shows here, not in the job's
// status. Alert on this number.
//   node tools/index-age.ts
import { loadAlertRunbooks, loadCastlane, loadKubernetesDocs } from "../src/corpus.ts";
import { pool } from "../src/db.ts";
import { slackSource } from "../src/events.ts";
import { indexAge } from "../src/log.ts";

const castlane = loadCastlane().filter((d) => !d.meta.deletedAt);
const listing = [...loadKubernetesDocs(), ...loadAlertRunbooks(), ...castlane.filter((d) => d.source !== "slack"), ...(await slackSource(castlane.filter((d) => d.source === "slack")))];
const newest = new Map<string, string>();
for (const d of listing) {
  const at = d.meta.updatedAt;
  if (at && (!newest.has(d.source) || Date.parse(at) > Date.parse(newest.get(d.source)!))) newest.set(d.source, at);
}
console.log(`source            docs  newest indexed            newest in source          behind`);
for (const r of await indexAge(newest))
  console.log(`${r.source.padEnd(17)} ${String(r.documents).padStart(5)}  ${(r.newestIndexed?.toISOString() ?? "-").padEnd(25)} ${(r.newestInSource ?? "-").padEnd(25)} ${r.behindMinutes} min`);
await pool.end();
