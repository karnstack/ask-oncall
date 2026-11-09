// What the engineer typed is not always a question. "and on the replica?" has
// nothing to search for; the thread above it does. Rewrite only when there is
// a thread to fold in: a standalone question goes to search as typed.
import { REWRITE_MODEL } from "./config.ts";
import { respond } from "./openai.ts";

export const rewritePrompt = (thread: string[]) =>
  `Rewrite the engineer's last message as one standalone search question. Use the earlier messages to fill in what the last message leaves out (the system, the service, the setting). Output only the question.

Thread:
${thread.join("\n")}`;

// thread: the earlier messages, oldest first; the last element is the new one.
export async function rewriteFollowUp(thread: string[]): Promise<{ question: string; usd: number; ms: number }> {
  if (thread.length < 2) return { question: thread.at(-1) ?? "", usd: 0, ms: 0 };
  const r = await respond("rewrite", REWRITE_MODEL, rewritePrompt(thread));
  return { question: r.text.trim(), usd: r.usd, ms: r.ms };
}

// A question that names a service ("pgbouncer-payouts pool saturated") can
// narrow the search before similarity. The services come from the documents'
// own front matter, so only names the index knows are matched.
export function serviceNamedIn(question: string, services: string[]): string | undefined {
  const q = question.toLowerCase();
  return [...services].sort((a, b) => b.length - a.length).find((s) => new RegExp(`(^|[^a-z0-9-])${s}($|[^a-z0-9-])`).test(q));
}
