// Context the chunk lost when it was cut. Two ways back:
//   the breadcrumb   the heading path, already the first line of every chunk
//                    (chunk.ts) and kept as a column for citations; free
//   model context    a small model reads the whole document and the chunk and
//                    writes a sentence or two (Anthropic's contextual retrieval)
// Measured per leg, model context helped word search, did nothing for vectors
// on written questions and hurt exact-name lookups on the vector leg. So it
// goes to the word leg only (the split design): the tsv column reads
// `context || body`, the embedding reads `body`. It is optional: run
// tools/contextualize.ts to pay for it (about $0.40 for the public docs).
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { encode, decode } from "gpt-tokenizer/encoding/cl100k_base";
import { CONTEXT_MODEL } from "./config.ts";
import { respond } from "./openai.ts";

const CACHE = ".cache/contexts.jsonl";
let cache: Map<string, string> | undefined;

// The context depends on the document and the chunk, so both key it.
export const contextKey = (docText: string, body: string) =>
  createHash("sha256").update(`${docText}\n\u0000\n${body}`).digest("hex");

export function cachedContext(docText: string, body: string): string | null {
  if (!cache) {
    cache = new Map();
    if (existsSync(CACHE))
      for (const line of readFileSync(CACHE, "utf8").split("\n").filter(Boolean)) {
        const { key, context } = JSON.parse(line);
        cache.set(key, context);
      }
  }
  return cache.get(contextKey(docText, body)) ?? null;
}

const DOC_CAP_TOKENS = 8000;

// Anthropic's published prompt, with the document first: every chunk of one
// document shares that prefix, so the provider's prompt cache keeps it warm.
export function contextPrompt(docText: string, chunk: string) {
  const tokens = encode(docText);
  const doc = tokens.length > DOC_CAP_TOKENS ? decode(tokens.slice(0, DOC_CAP_TOKENS)) + "\n[document truncated]" : docText;
  return `<document>
${doc}
</document>
Here is the chunk we want to situate within the whole document
<chunk>
${chunk}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;
}

export async function contextualize(doc: { id: string; text: string }, body: string): Promise<string> {
  const hit = cachedContext(doc.text, body);
  if (hit != null) return hit;
  const cacheKey = createHash("sha256").update(doc.id).digest("hex").slice(0, 32); // prompt_cache_key: at most 64 characters
  const r = await respond("context", CONTEXT_MODEL, contextPrompt(doc.text, body), { effort: "minimal", cacheKey });
  const context = r.text.trim();
  mkdirSync(".cache", { recursive: true });
  appendFileSync(CACHE, JSON.stringify({ key: contextKey(doc.text, body), context }) + "\n");
  cache!.set(contextKey(doc.text, body), context);
  return context;
}
