// The question path: rewrite a follow-up, search both legs inside the asker's
// permissions, fuse, rerank, answer from what the reranker kept, and check
// the answer.
//   npm run ask -- "How do I fail over Postgres?" --as tw
//   npm run ask -- "and on the replica?" --as tw --thread "how do I see how many clients are waiting on pgbouncer-feeds"
import { parseArgs } from "node:util";
import { principalsOf, userByHandle } from "./access.ts";
import { answer, sourceLine } from "./answer.ts";
import { checkAnswer, citedSentence, passed, quotedSpans } from "./checks.ts";
import { RERANK_CANDIDATES, RERANK_KEEP } from "./config.ts";
import { pool } from "./db.ts";
import { rerank } from "./rerank.ts";
import { rewriteFollowUp } from "./rewrite.ts";
import { hybridSearch, type Filter, type Hit } from "./search.ts";
import { indexVersion } from "./sync.ts";

export type AskOptions = {
  asker: string; // a handle from identity.json
  thread?: string[]; // earlier messages in the thread, oldest first
  scope?: string;
  service?: string;
  now?: Date;
  onDelta?: (text: string) => void;
};

export async function ask(question: string, opts: AskOptions) {
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

  // 2. both legs, inside the asker's permissions, current documents only
  const principals = principalsOf(userByHandle(opts.asker));
  const filter: Filter = { principals, currentOnly: true, scope: opts.scope, service: opts.service };
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

  // 5. check it
  const checks = checkAnswer(text, kept);
  const version = await indexVersion();
  return { question, searched, text, sources: kept, candidates, checks, ms, usd, indexVersion: version };
}

// ---- the command line ---------------------------------------------------------

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { as: { type: "string", default: "dara" }, thread: { type: "string", multiple: true }, scope: { type: "string" }, service: { type: "string" }, now: { type: "string" } },
  });
  const question = positionals.join(" ");
  if (!question) throw new Error(`usage: npm run ask -- "your question" --as <handle> [--thread "earlier message"] [--scope payouts]`);
  const now = values.now ? new Date(values.now) : new Date();
  const r = await ask(question, { asker: values.as!, thread: values.thread, scope: values.scope, service: values.service, now, onDelta: (s) => process.stdout.write(s) });
  console.log("\n");
  if (r.searched !== question) console.log(`searched as: ${r.searched}`);
  console.log(`sources (asked as ${values.as}, index version ${r.indexVersion}):`);
  r.sources.forEach((s, i) => console.log(`  ${sourceLine(s, i, now)}${s.breadcrumb ? `\n      ${s.breadcrumb}` : ""}`));
  for (const span of quotedSpans(r.text).slice(0, 4)) {
    const from = r.sources.map((s) => citedSentence(s.body, span)).find(Boolean);
    if (from) console.log(`  quoted: "${span}"\n      from: ${from.slice(0, 200)}`);
  }
  const c = r.checks;
  console.log(
    `checks: ${passed(c) ? "pass" : "FAIL"} (${c.citations} citations, ${c.badCitations.length} bad; ${c.quotes} quotes, ` +
      `${c.unverifiedQuotes.length} not in the sources; ${c.foreignLinks.length} foreign links)`,
  );
  if (!passed(c)) console.log(`  ${JSON.stringify({ bad: c.badCitations, quotes: c.unverifiedQuotes, links: c.foreignLinks })}`);
  console.log(`time: ${Object.entries(r.ms).map(([k, v]) => `${k} ${Math.round(v)} ms`).join(", ")}`);
  console.log(`cost: $${r.usd.toFixed(5)}`);
  await pool.end();
}
