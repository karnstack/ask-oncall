// Chunkers. A chunk's id is its document id plus its position, `doc_id::n`.
import { encode, decode } from "gpt-tokenizer/encoding/cl100k_base"; // the embedding models' tokenizer
import { CHUNK_MAX_TOKENS, CHUNK_MIN_TOKENS, CHUNK_OVERLAP, CHUNK_TOKENS } from "./config.ts";

export const countTokens = (s: string) => encode(s).length;

type Source = { id: string; title: string; text: string };

export type Chunk = {
  id: string; // `${docId}::${n}`
  docId: string;
  n: number;
  start: number; // the character range of the document this chunk covers
  end: number;
  breadcrumb: string; // the heading path above the chunk
  body: string; // what is embedded, searched and sent: the breadcrumb line, then the text
};

// The first try: fixed token windows with overlap, blind to structure.
export function chunkFixed(doc: Source, size = CHUNK_TOKENS, overlap = CHUNK_OVERLAP): Chunk[] {
  const tokens = encode(doc.text);
  const chunks: Chunk[] = [];
  let cursor = 0;
  for (let i = 0, n = 0; i < tokens.length; i += size - overlap, n++) {
    const body = decode(tokens.slice(i, i + size));
    let start = doc.text.indexOf(body.slice(0, 40), Math.max(0, cursor - 2000));
    if (start < 0) start = cursor;
    cursor = start + 1;
    chunks.push({ id: `${doc.id}::${n}`, docId: doc.id, n, start, end: start + body.length, breadcrumb: doc.title, body });
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
// character range it covers (nested sections included).
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

// Cut where the authors cut: at headings, never inside a code fence. Merge a
// leaf section under CHUNK_MIN_TOKENS into the next one, split a section over
// CHUNK_MAX_TOKENS at blank lines, and hard-cap anything still over twice that.
// Each chunk starts with its heading path, the breadcrumb.
export function chunkByHeadings(doc: Source, maxTokens = CHUNK_MAX_TOKENS, minTokens = CHUNK_MIN_TOKENS): Chunk[] {
  const sections = sectionsOf(doc);
  const starts = sections.map((s) => s.start).concat(doc.text.length);
  const spans: { start: number; end: number; path: string[] }[] = [];
  if (sections.length === 0 || sections[0].start > 0)
    spans.push({ start: 0, end: sections[0]?.start ?? doc.text.length, path: [doc.title] });
  sections.forEach((s, i) => spans.push({ start: s.start, end: starts[i + 1], path: s.path }));

  const merged: typeof spans = [];
  for (const span of spans) {
    const prev = merged[merged.length - 1];
    if (prev && countTokens(doc.text.slice(prev.start, prev.end)) < minTokens && countTokens(doc.text.slice(prev.start, span.end)) <= maxTokens)
      prev.end = span.end; // keep the earlier, shallower breadcrumb
    else merged.push({ ...span });
  }

  const chunks: Chunk[] = [];
  const push = (start: number, end: number, path: string[]) => {
    const text = doc.text.slice(start, end).trim();
    if (!text) return;
    const breadcrumb = path.join(" > ");
    const n = chunks.length;
    chunks.push({ id: `${doc.id}::${n}`, docId: doc.id, n, start, end, breadcrumb, body: `${breadcrumb}\n\n${text}` });
  };
  for (const span of merged) {
    const t = doc.text.slice(span.start, span.end);
    if (countTokens(t) <= maxTokens) {
      push(span.start, span.end, span.path);
      continue;
    }
    // a long section: split at blank lines, never inside a code fence
    let pieceStart = span.start;
    let tokens = 0;
    let inFence = false;
    let offset = span.start;
    for (const para of t.split(/(?<=\n\n)/)) {
      const fences = (para.match(/^\s*(```|~~~)/gm) ?? []).length;
      const tk = countTokens(para);
      if (!inFence && tokens > 0 && tokens + tk > maxTokens) {
        push(pieceStart, offset, span.path);
        pieceStart = offset;
        tokens = 0;
      }
      tokens += tk;
      offset += para.length;
      if (fences % 2 === 1) inFence = !inFence;
    }
    push(pieceStart, span.end, span.path);
  }
  // the hard cap: one giant paragraph or code block still gets token-split
  return chunks
    .flatMap((c) => {
      const text = c.body.slice(c.breadcrumb.length + 2);
      if (countTokens(text) <= maxTokens * 2) return [c];
      return chunkFixed({ id: doc.id, title: doc.title, text }, maxTokens, CHUNK_OVERLAP).map((s) => ({
        ...c, start: c.start + s.start, end: c.start + s.end, body: `${c.breadcrumb}\n\n${s.body}`,
      }));
    })
    .map((c, n) => ({ ...c, n, id: `${doc.id}::${n}` }));
}
