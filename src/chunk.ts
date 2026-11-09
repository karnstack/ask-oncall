// Chunks. A chunk's id is its document id plus its position, `doc_id::n`.
import { encode, decode } from "gpt-tokenizer/encoding/cl100k_base"; // the embedding models' tokenizer
import { CHUNK_OVERLAP, CHUNK_TOKENS } from "./config.ts";

export const countTokens = (s: string) => encode(s).length;

type Source = { id: string; title: string; text: string };

export type Chunk = {
  id: string; // `${docId}::${n}`
  docId: string;
  n: number;
  start: number; // the character range of the document this chunk covers
  end: number;
  body: string; // what is embedded, searched and sent
};

// Fixed token windows with overlap, blind to structure: the common default.
export function chunkFixed(doc: Source, size = CHUNK_TOKENS, overlap = CHUNK_OVERLAP): Chunk[] {
  const tokens = encode(doc.text);
  const chunks: Chunk[] = [];
  let cursor = 0;
  for (let i = 0, n = 0; i < tokens.length; i += size - overlap, n++) {
    const body = decode(tokens.slice(i, i + size));
    let start = doc.text.indexOf(body.slice(0, 40), Math.max(0, cursor - 2000));
    if (start < 0) start = cursor;
    cursor = start + 1;
    chunks.push({ id: `${doc.id}::${n}`, docId: doc.id, n, start, end: start + body.length, body });
    if (i + size >= tokens.length) break;
  }
  return chunks;
}

// GitHub-style heading anchors, which is what kubernetes.io uses.
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

export type Section = { slug: string; path: string[]; level: number; start: number; end: number };

// Every Markdown heading outside a code fence, with its path and the
// character range it covers (nested sections included). Labels name
// sections by these anchors.
export function sectionsOf(doc: { text: string }): Section[] {
  const heads: { level: number; title: string; anchor?: string; pos: number }[] = [];
  let inFence = false;
  let pos = 0;
  for (const line of doc.text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && /^(#{1,6})\s+(.+?)\s*(\{#([^}]+)\})?\s*$/.exec(line);
    if (m) heads.push({ level: m[1].length, title: m[2], anchor: m[4], pos });
    pos += line.length + 1;
  }
  const out: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  heads.forEach((h, i) => {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
    let end = doc.text.length;
    for (let j = i + 1; j < heads.length; j++)
      if (heads[j].level <= h.level) {
        end = heads[j].pos;
        break;
      }
    out.push({ slug: h.level === 1 ? "" : (h.anchor ?? slugify(h.title)), path: stack.map((s) => s.title), level: h.level, start: h.pos, end });
  });
  return out;
}
