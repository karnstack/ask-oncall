// Pay for model-written context on the word leg (the split design). Each
// chunk gets a sentence or two from CONTEXT_MODEL, written into chunks.context;
// the tsv column reads it, the embedding does not. Cached, so only new chunks
// cost. Castlane's 553 chunks cost about 3 cents; --all adds the public docs
// (about 9,100 chunks, about $0.40 at batch price, more at standard).
//   node tools/contextualize.ts [--all] [--limit 20]
import { parseArgs } from "node:util";
import { loadCorpus } from "../src/corpus.ts";
import { contextualize } from "../src/context.ts";
import { pool } from "../src/db.ts";
import { spentSoFar } from "../src/ledger.ts";

const { values } = parseArgs({ options: { all: { type: "boolean" }, limit: { type: "string" } } });
const docs = new Map(loadCorpus().map((d) => [d.id, d]));
const { rows } = await pool.query(
  `select id, doc_id, body from chunks where context is null ${values.all ? "" : `and source not in ('k8s-docs', 'prom-runbooks')`} order by doc_id, n ${values.limit ? `limit ${Number(values.limit)}` : ""}`,
);
const before = spentSoFar();
let done = 0;
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < rows.length) {
    const r = rows[next++];
    const doc = docs.get(r.doc_id);
    if (!doc) continue;
    await pool.query(`update chunks set context = $2 where id = $1`, [r.id, await contextualize(doc, r.body)]);
    if (++done % 100 === 0) console.log(`${done} of ${rows.length}, $${(spentSoFar() - before).toFixed(4)}`);
  }
}));
console.log(`contextualized ${done} chunks for $${(spentSoFar() - before).toFixed(4)}; the word leg reads them now (the tsv column is generated)`);
await pool.end();
