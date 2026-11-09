// Story checks: pass-or-fail tests of index state. Relevance is measured
// (tools/score.ts); state is tested. Run after every ingest:
//   node tools/story-checks.ts
import { loadCastlane } from "../src/corpus.ts";
import { pool } from "../src/db.ts";

const V2 = "runbooks/postgres-failover.md@v2";
const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n);

const checks: [string, () => Promise<boolean | string>][] = [
  // deleted, but still answering
  ["failover v2 (deleted 2026-06-18) has no chunks", async () => (await count(`select count(*) n from chunks where doc_id = $1`, [V2])) === 0],
  ["no chunk belongs to a tombstoned document", async () =>
    (await count(`select count(*) n from chunks c join documents d on d.id = c.doc_id where d.deleted_at is not null`)) === 0],
  ["every live Castlane document has chunks", async () => {
    const live = loadCastlane().filter((d) => !d.meta.deletedAt).map((d) => d.id);
    const n = await count(`select count(distinct doc_id) n from chunks where doc_id = any($1::text[])`, [live]);
    return n === live.length || `${live.length - n} live documents without chunks`;
  }],
];

let failed = 0;
for (const [name, check] of checks) {
  const result = await check().catch((e) => `error: ${e.message}`);
  const ok = result === true;
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `  (${result})`}`);
}
console.log(`${checks.length - failed} of ${checks.length} story checks pass`);
await pool.end();
process.exitCode = failed ? 1 : 0;
