// The index path, the job that runs every night (and on demand):
//   npm run ingest
// Each source is listed, every changed document is re-chunked and re-embedded
// (only new text costs), every missing document is tombstoned within the
// reconcile bound, and near-copies of dead documents take their status.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAlertRunbooks, loadCastlane, loadKubernetesDocs } from "./corpus.ts";
import { pool } from "./db.ts";
import { slackSource } from "./events.ts";
import { spentSoFar } from "./ledger.ts";
import { emptyStats, markNearCopies, syncSources } from "./sync.ts";

const t0 = performance.now();
await pool.query(readFileSync(join(import.meta.dirname, "..", "sql", "001_schema.sql"), "utf8"));

const castlane = loadCastlane(); // every file, deleted ones included
const live = castlane.filter((d) => !d.meta.deletedAt);
const listing = [
  ...loadKubernetesDocs(),
  ...loadAlertRunbooks(),
  ...live.filter((d) => d.source !== "slack"),
  ...(await slackSource(live.filter((d) => d.source === "slack"))),
];
console.log(`listed ${listing.length} documents (${listing.length - live.length} public, ${live.length} Castlane)`);

const stats = await syncSources(listing, emptyStats());
console.log(
  `unchanged ${stats.unchanged}, replaced ${stats.replaced} (${stats.chunks} chunks), tombstoned ${stats.tombstoned}; ` +
    `embedded ${stats.embed.embedded} of ${stats.embed.texts} chunk texts, ${stats.embed.tokens} tokens, $${stats.embed.usd.toFixed(5)}`,
);
for (const r of stats.refused) console.log(`reconcile refused: ${r}`);

// dead documents the sources still describe: deleted, or superseded
const dead = castlane.filter((d) => d.meta.deletedAt || (!d.meta.isCurrent && d.meta.supersededBy));
const copies = await markNearCopies(dead);
for (const c of copies) console.log(`near-copy: ${c.docId} is ${c.matched} of ${c.chunks} chunks like ${c.of} (max Jaccard ${c.max.toFixed(3)})`);

const { rows } = await pool.query(`select count(*)::int as chunks, pg_size_pretty(pg_total_relation_size('chunks')) as size from chunks`);
console.log(`index: ${rows[0].chunks} chunks, ${rows[0].size}; ${((performance.now() - t0) / 1000).toFixed(1)} s; ledger total $${spentSoFar().toFixed(4)}`);
await pool.end();
