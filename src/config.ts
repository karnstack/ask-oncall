// Every model id, size, price and knob lives here and nowhere else.

// The embedding model, at its full size.
export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 1536;

// Chunks: fixed windows (the first try), then cuts at headings.
export const CHUNK_TOKENS = 512;
export const CHUNK_OVERLAP = 64;
export const CHUNK_MAX_TOKENS = 512; // split a section at blank lines above this
export const CHUNK_MIN_TOKENS = 80; // merge a leaf section below this into the next

// The first stage: each leg's top 50, fused by reciprocal rank fusion.
export const CANDIDATES = 50;
export const RRF_K = 60;

// The reranker reads the first RERANK_CANDIDATES fused chunks and keeps at
// most RERANK_KEEP.
export const RERANK_MODEL = "gpt-5.4-mini";
export const RERANK_CANDIDATES = 50;
export const RERANK_KEEP = 5;
export const RERANK_CLIP_TOKENS = 200;

// The answer model.
export const ANSWER_MODEL = "gpt-5.4-mini";

// US$ per 1,000,000 tokens, checked 2026-11-08 at
// https://developers.openai.com/api/docs/pricing (re-check before you trust a bill).
export type Price = { input: number; cachedInput: number; output: number };
export const PRICES_CHECKED = "2026-11-08";
export const PRICES: Record<string, Price> = {
  "text-embedding-3-small": { input: 0.02, cachedInput: 0.02, output: 0 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
};

// Every call is priced into the ledger; a step that would take the total past
// this many dollars refuses to start.
export const BUDGET_USD = Number(process.env.BUDGET_USD ?? 5);
