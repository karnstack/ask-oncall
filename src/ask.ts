// The question path: rewrite a follow-up, search both legs, fuse, rerank, and
// answer from what the reranker kept.
//   npm run ask -- "How do I fail over Postgres?"
//   npm run ask -- "and on the replica?" --thread "how do I see how many clients are waiting on pgbouncer-feeds"
import { parseArgs } from "node:util";
import { answer, sourceLine } from "./answer.ts";
import { RERANK_CANDIDATES, RERANK_KEEP } from "./config.ts";
import { pool } from "./db.ts";
import { rerank } from "./rerank.ts";
import { rewriteFollowUp } from "./rewrite.ts";
import { hybridSearch, type Filter, type Hit } from "./search.ts";

export type AskOptions = {
  thread?: string[]; // earlier messages in the thread, oldest first
  service?: string;
  now?: Date;
  onDelta?: (text: string) => void;
};

export async function ask(question: string, opts: AskOptions = {}) {
  const t0 = performance.now();
  const ms: Record<string, number> = {};
  let usd = 0;

  // 1. a follow-up becomes a standalone question
  let searched = question;
  if (opts.thread?.length) {
    const r = await rewriteFollowUp([...opts.thread, question]);
    searched = r.question;
    ms.rewrite = r.ms;
    usd += r.usd;
  }

  // 2. both legs, current documents only
  const filter: Filter = { currentOnly: true, service: opts.service };
  const first = await hybridSearch(searched, filter);
  Object.assign(ms, first.ms);

  // 3. the reranker reads the top candidates and keeps at most five
  const candidates = first.fused.slice(0, RERANK_CANDIDATES);
  let kept: Hit[] = [];
  if (candidates.length) {
    const rr = await rerank(searched, candidates);
    kept = rr.kept;
    ms.rerank = rr.ms;
    usd += rr.usd;
  }

  // 4. answer from what was kept (the first five, if the reranker kept none)
  if (!kept.length) kept = candidates.slice(0, RERANK_KEEP);
  const a = await answer(searched, kept, { now: opts.now, onDelta: opts.onDelta });
  const text = a.text;
  ms.firstToken = performance.now() - t0 - a.ms + a.firstTokenMs;
  ms.answer = a.ms;
  usd += a.usd;
  ms.total = performance.now() - t0;

  return { question, searched, text, sources: kept, candidates, ms, usd };
}

// ---- the command line ---------------------------------------------------------

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { thread: { type: "string", multiple: true }, service: { type: "string" }, now: { type: "string" } },
  });
  const question = positionals.join(" ");
  if (!question) throw new Error(`usage: npm run ask -- "your question" [--thread "earlier message"]`);
  const now = values.now ? new Date(values.now) : new Date();
  const r = await ask(question, { thread: values.thread, service: values.service, now, onDelta: (s) => process.stdout.write(s) });
  console.log("\n");
  if (r.searched !== question) console.log(`searched as: ${r.searched}`);
  console.log(`sources:`);
  r.sources.forEach((s, i) => console.log(`  ${sourceLine(s, i, now)}${s.breadcrumb ? `\n      ${s.breadcrumb}` : ""}`));
  console.log(`time: ${Object.entries(r.ms).map(([k, v]) => `${k} ${Math.round(v)} ms`).join(", ")}`);
  console.log(`cost: $${r.usd.toFixed(5)}`);
  await pool.end();
}
