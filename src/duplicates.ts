// A delete removes one document, not its copies. Word 5-grams and Jaccard
// find a document that is nearly the text of a dead one (deleted, or
// superseded), in another source and under another id.
import { DUPLICATE_JACCARD } from "./config.ts";

export function shingles(text: string, n = 5): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9_.\-]+/g) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
}

export type Texts = { docId: string; chunks: string[] };
export type NearCopy = { docId: string; of: string; matched: number; chunks: number; max: number };

// A live document is a copy of a dead one when more than half of its chunks
// overlap one of that document's chunks above the threshold.
export function findNearCopies(live: Texts[], dead: Texts[], threshold = DUPLICATE_JACCARD): NearCopy[] {
  const deadSets = dead.map((d) => ({ docId: d.docId, sets: d.chunks.map((c) => shingles(c)) }));
  const out: NearCopy[] = [];
  for (const doc of live) {
    if (dead.some((d) => d.docId === doc.docId)) continue;
    const sets = doc.chunks.map((c) => shingles(c));
    for (const ref of deadSets) {
      const best = sets.map((s) => Math.max(0, ...ref.sets.map((r) => jaccard(s, r))));
      const matched = best.filter((j) => j > threshold).length;
      if (matched * 2 > sets.length) out.push({ docId: doc.docId, of: ref.docId, matched, chunks: sets.length, max: Math.max(...best) });
    }
  }
  return out;
}
