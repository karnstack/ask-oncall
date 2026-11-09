// Chunks. A chunk's id is its document id plus its position, `doc_id::n`.
import { encode, decode } from "gpt-tokenizer/encoding/cl100k_base"; // the embedding models' tokenizer
import { CHUNK_OVERLAP, CHUNK_TOKENS } from "./config.ts";

export const countTokens = (s: string) => encode(s).length;

type Source = { id: string; text: string };

export type Chunk = {
  id: string; // `${docId}::${n}`
  docId: string;
  n: number;
  body: string; // what is embedded, searched and sent
};

// Fixed token windows with overlap, blind to structure: the common default.
export function chunkFixed(doc: Source, size = CHUNK_TOKENS, overlap = CHUNK_OVERLAP): Chunk[] {
  const tokens = encode(doc.text);
  const chunks: Chunk[] = [];
  for (let i = 0, n = 0; i < tokens.length; i += size - overlap, n++) {
    chunks.push({ id: `${doc.id}::${n}`, docId: doc.id, n, body: decode(tokens.slice(i, i + size)) });
    if (i + size >= tokens.length) break;
  }
  return chunks;
}
