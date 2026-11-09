// Changing the embedding model without a night of mixed answers. Vectors from
// two models live in two spaces: a vector(1536) column takes any 1,536
// numbers, so writing the new model's vectors into the old column breaks
// search with no error. Instead:
//   npm run migrate -- add         a shadow column, and the model that filled it
//   npm run migrate -- backfill    fill it in batches (--castlane: Castlane only)
//   npm run migrate -- score       both question sets, old column vs shadow column
//   npm run migrate -- drop        keep what you have, and drop the shadow
// Switching is one change in config.ts (EMBED_MODEL, EMBED_DIMS, EMBED_COLUMN),
// for the questions and the chunks at once; keep the old column a day.
import { parseArgs } from "node:util";
import { EMBED_COLUMN, EMBED_MODEL, PRICES, SHADOW_COLUMN, SHADOW_DIMS, SHADOW_MODEL } from "./config.ts";
import { pool, toPg } from "./db.ts";
import { embed } from "./embed.ts";
import { countTokens } from "./chunk.ts";
import { assertBudget } from "./ledger.ts";

export async function addShadow() {
  await pool.query(`alter table chunks add column if not exists ${SHADOW_COLUMN} vector(${SHADOW_DIMS}),
                                       add column if not exists embedding_model text`);
}

export async function backfill(opts: { castlaneOnly?: boolean; batch?: number } = {}) {
  const where = `embedding_model is distinct from $1${opts.castlaneOnly ? ` and source not in ('k8s-docs', 'prom-runbooks')` : ""}`;
  const todo = (await pool.query(`select count(*)::int as n, coalesce(sum(length(body)), 0)::bigint as chars from chunks where ${where}`, [SHADOW_MODEL])).rows[0];
  console.log(`backfill ${todo.n} rows with ${SHADOW_MODEL} into ${SHADOW_COLUMN}`);
  const batch = opts.batch ?? 1024;
  let tokens = 0, usd = 0;
  for (;;) {
    const { rows } = await pool.query(`select id, body from chunks where ${where} order by id limit ${batch}`, [SHADOW_MODEL]);
    if (!rows.length) break;
    const planned = rows.reduce((s, r) => s + countTokens(r.body), 0);
    assertBudget((planned * PRICES[SHADOW_MODEL].input) / 1_000_000);
    const stats = { texts: 0, embedded: 0, tokens: 0, usd: 0, ms: 0 };
    const vectors = await embed(rows.map((r) => r.body), { model: SHADOW_MODEL, dims: SHADOW_DIMS, stage: "migrate:backfill", stats });
    await pool.query(
      `update chunks c set ${SHADOW_COLUMN} = v.e::vector, embedding_model = $3
         from unnest($1::text[], $2::text[]) as v(id, e) where c.id = v.id`,
      [rows.map((r) => r.id), vectors.map((v) => toPg(v)), SHADOW_MODEL],
    );
    tokens += stats.tokens;
    usd += stats.usd;
    process.stdout.write(".");
  }
  const size = (await pool.query(`select pg_size_pretty(pg_total_relation_size('chunks')) as s`)).rows[0].s;
  console.log(`\n${tokens} tokens embedded, $${usd.toFixed(4)}; chunks is now ${size}`);
}

export async function dropShadow() {
  await pool.query(`alter table chunks drop column if exists ${SHADOW_COLUMN}, drop column if exists embedding_model`);
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { castlane: { type: "boolean" } } });
  const step = positionals[0];
  if (step === "add") await addShadow();
  else if (step === "backfill") await backfill({ castlaneOnly: values.castlane });
  else if (step === "drop") await dropShadow();
  else if (step === "score") {
    const { compareColumns } = await import("../tools/score.ts");
    await compareColumns({ column: EMBED_COLUMN, model: EMBED_MODEL }, { column: SHADOW_COLUMN, model: SHADOW_MODEL, dims: SHADOW_DIMS }, values.castlane);
  } else console.log(`usage: npm run migrate -- add | backfill [--castlane] | score [--castlane] | drop`);
  await pool.end();
}
