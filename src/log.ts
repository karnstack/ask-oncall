// One log line per question: enough to replay any answer, sources and all.
// A bad answer has no error and normal latency; this line is how you see it.
import { appendFileSync, mkdirSync } from "node:fs";
import { pool } from "./db.ts";

export const LOG_FILE = "logs/questions.jsonl";

export type QuestionLog = {
  at: string;
  question: string;
  rewrite: string | null; // the standalone question searched, when a thread was folded in
  asker: string;
  principalsHash: string; // the same hash every cache key carries
  filter: { currentOnly: boolean; scope: string | null; service: string | null };
  indexVersion: number;
  ranks: { vector: string[]; word: string[]; fused: string[] }; // chunk ids, best first (top 10 each)
  kept: string[]; // what the reranker kept
  sent: string[]; // what the answer model read, [1] first
  cited: string[]; // the sources the answer cites
  notFound: boolean;
  checks: { badCitations: number[]; unverifiedQuotes: string[]; foreignLinks: string[] };
  ms: Record<string, number>;
  usd: number;
  answer: string;
  feedback: "yes" | "no" | null; // "Did this answer your question?"
};

export function logQuestion(line: QuestionLog) {
  mkdirSync("logs", { recursive: true });
  appendFileSync(LOG_FILE, JSON.stringify(line) + "\n");
}

// Index age per source: how far the newest indexed document trails the newest
// one in the source. A sync that stops looks exactly like one with nothing to
// do, so alert on this number, not on the job's status.
export async function indexAge(newestInSource: Map<string, string>) {
  const { rows } = await pool.query(
    `select source, count(*)::int as documents, max(updated_at) as newest_indexed, max(indexed_at) as last_sync
       from documents where deleted_at is null group by source order by source`,
  );
  return rows.map((r) => {
    const inSource = newestInSource.get(r.source) ?? null;
    const behindMs = inSource && r.newest_indexed ? Math.max(0, Date.parse(inSource) - r.newest_indexed.getTime()) : 0;
    return { source: r.source as string, documents: r.documents as number, newestIndexed: r.newest_indexed as Date | null, newestInSource: inSource, behindMinutes: Math.round(behindMs / 60_000), lastSync: r.last_sync as Date };
  });
}
