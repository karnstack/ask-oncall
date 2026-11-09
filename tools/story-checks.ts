// Story checks: pass-or-fail tests of index state. Relevance is measured
// (tools/score.ts); state is tested. Run after every ingest:
//   node tools/story-checks.ts
import { principalsOf, userByHandle } from "../src/access.ts";
import { loadCastlane } from "../src/corpus.ts";
import { pool } from "../src/db.ts";
import { hybridSearch } from "../src/search.ts";
import { reconcilePlan } from "../src/sync.ts";

const V2 = "runbooks/postgres-failover.md@v2";
const WIKI = "wiki-export-2024/Postgres_Failover.md";
const PGB3 = "runbooks/pgbouncer.md@v3";
const SECURITY = ["postmortems/INC-2207.md", "slack/inc-2207/2026-09-15.json"];
const as = (handle: string) => principalsOf(userByHandle(handle));
const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n);

const checks: [string, () => Promise<boolean | string>][] = [
  // deleted, but still answering
  ["failover v2 (deleted 2026-06-18) has no chunks", async () => (await count(`select count(*) n from chunks where doc_id = $1`, [V2])) === 0],
  ["no chunk belongs to a tombstoned document", async () =>
    (await count(`select count(*) n from chunks c join documents d on d.id = c.doc_id where d.deleted_at is not null`)) === 0],
  // the copy the delete missed
  ["the wiki copy of failover v2 is marked a copy", async () =>
    (await count(`select count(*) n from documents where id = $1 and duplicate_of = $2 and deleted_at is not null`, [WIKI, V2])) === 1],
  ["reconcile refuses an empty listing", async () => {
    const known = (await pool.query(`select id from documents where source = 'runbooks' and deleted_at is null`)).rows.map((r) => r.id);
    return reconcilePlan(known, []).refused;
  }],
  ["reconcile refuses a listing that drops more than half", async () => {
    const known = (await pool.query(`select id from documents where deleted_at is null and source not in ('k8s-docs', 'prom-runbooks')`)).rows.map((r) => r.id);
    return reconcilePlan(known, known.filter((id) => id.startsWith("runbooks/"))).refused;
  }],
  // two versions, one right answer
  ["the pool-size question never retrieves a superseded version", async () => {
    for (const q of ["What should default_pool_size be on pgbouncer-feeds?", "default_pool_size pgbouncer-feeds", "pgbouncer-feeds pool size setting"]) {
      const { fused } = await hybridSearch(q, { principals: as("zi"), currentOnly: true });
      if (fused.some((h) => h.docId === PGB3)) return `v3 retrieved for "${q}"`;
    }
    return true;
  }],
  // who may read this chunk
  ["a contractor's payouts question never retrieves a security or payouts-only document", async () => {
    const { fused } = await hybridSearch("why were creator payouts late on Tuesday?", { principals: as("ext-rb"), currentOnly: true });
    const bad = fused.filter((h) => [...SECURITY, "reports/payouts-2026-09.md", "slack/incidents/2026-09-15.json"].includes(h.docId));
    return bad.length ? `retrieved ${bad.map((h) => h.id).join(", ")}` : true;
  }],
  // jh may read the restricted #inc-2207 channel (user:jh), never the security postmortem
  ["a payouts engineer gets the run summary and never the postmortem", async () => {
    const { fused } = await hybridSearch("why were creator payouts late on Tuesday 2026-09-15?", { principals: as("jh"), currentOnly: true });
    if (fused.some((h) => h.docId === SECURITY[0])) return "retrieved the security postmortem";
    return fused.slice(0, 10).some((h) => h.docId === "reports/payouts-2026-09.md") || "run summary not in the top 10";
  }],
  ["every live Castlane document has chunks", async () => {
    const live = loadCastlane().filter((d) => !d.meta.deletedAt && d.id !== WIKI).map((d) => d.id);
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
