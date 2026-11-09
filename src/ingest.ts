// The index path, the job that runs every night (and on demand):
//   npm run ingest
// Each source is listed, every changed document is re-chunked and re-embedded
// (only new text costs), and every missing document is tombstoned.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCorpus } from "./corpus.ts";
import { pool } from "./db.ts";
import { spentSoFar } from "./ledger.ts";
import { emptyStats, syncSources } from "./sync.ts";

const t0 = performance.now();
await pool.query(readFileSync(join(import.meta.dirname, "..", "sql", "001_schema.sql"), "utf8"));

const listing = loadCorpus(); // today: deleted documents are not listed
console.log(`listed ${listing.length} documents`);

const stats = await syncSources(listing, emptyStats());
console.log(
  `unchanged ${stats.unchanged}, replaced ${stats.replaced} (${stats.chunks} chunks), tombstoned ${stats.tombstoned}; ` +
    `embedded ${stats.embed.embedded} of ${stats.embed.texts} chunk texts, ${stats.embed.tokens} tokens, $${stats.embed.usd.toFixed(5)}`,
);

const { rows } = await pool.query(`select count(*)::int as chunks, pg_size_pretty(pg_total_relation_size('chunks')) as size from chunks`);
console.log(`index: ${rows[0].chunks} chunks, ${rows[0].size}; ${((performance.now() - t0) / 1000).toFixed(1)} s; ledger total $${spentSoFar().toFixed(4)}`);
await pool.end();
