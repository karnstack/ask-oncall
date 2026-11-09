// The answer: numbered sources with title, version and age, Castlane's house
// rules (ADR-0038, handbook v6), streamed, never stored by the provider.
import { ANSWER_MODEL } from "./config.ts";
import { respondStream } from "./openai.ts";

export const NOT_FOUND = "Not found in Castlane's docs";

export type Source = { title: string; url: string; body: string; version: number | null; updatedAt: string | null };

export const daysAgo = (iso: string, now: Date) => Math.round((now.getTime() - Date.parse(iso.slice(0, 10))) / 86_400_000);

// "[2] PgBouncer (pgbouncer-feeds, pgbouncer-payouts) (v4, updated 6 days ago) https://..."
export function sourceLine(s: Source, i: number, now = new Date()) {
  const version = s.version != null ? `v${s.version}, ` : "";
  const age = s.updatedAt ? `updated ${daysAgo(s.updatedAt, now)} days ago` : "public docs";
  return `[${i + 1}] ${s.title} (${version}${age}) ${s.url}`;
}

export function answerPrompt(question: string, sources: Source[], now = new Date()) {
  const excerpts = sources.map((s, i) => `${sourceLine(s, i, now)}\n${s.body}`).join("\n\n---\n\n");
  return `You are #ask-oncall, Castlane's read-only assistant for on-call engineers. Answer using ONLY the numbered sources below.
- Cite every claim with its source number in square brackets, like [2].
- Quote commands and settings exactly as the source writes them.
- Never suggest a command that is not in a cited source.
- If the sources do not answer the question, reply exactly "${NOT_FOUND}" and then list the titles of the three nearest sources.
Keep it under 120 words.

Sources:
${excerpts}

Question: ${question}`;
}

export async function answer(question: string, sources: Source[], opts: { now?: Date; onDelta?: (s: string) => void } = {}) {
  return respondStream("answer", ANSWER_MODEL, answerPrompt(question, sources, opts.now), opts.onDelta);
}
