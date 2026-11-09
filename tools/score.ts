// The question set, scored. Every retrieval change in the course is decided
// here: recall at k, mean reciprocal rank, and which questions moved.
//   npm run score -- --set written --save small
//   npm run score -- --set written --against small
//   npm run score -- --set castlane
// Labels name a document, optionally a section and a phrase, never a chunk id,
// so they survive re-chunking. One written question is about 2 points of
// recall; a change under 3 questions is noise.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { sectionsOf, type Section } from "../src/chunk.ts";
import { loadAlertRunbooks, loadCastlane, loadKubernetesDocs, type Doc } from "../src/corpus.ts";
import { pool } from "../src/db.ts";
import { embedQuestion } from "../src/embed.ts";
import { vectorSearch, type Hit } from "../src/search.ts";

export type Target = { doc: string; section?: string; contains?: string };
export type Question = {
  id: string;
  type: string; // nl, id, para, multi, none
  q: string;
  targets: Target[][]; // every inner list is one thing the answer needs; any alternative in it counts
  asker?: string; // Castlane questions: who asked
};

const QUESTIONS = join(import.meta.dirname, "..", "questions");
export const SETS = ["written", "unanswerable", "near-miss", "castlane"] as const;
export type SetName = (typeof SETS)[number];

export function loadQuestions(set: SetName): Question[] {
  const read = (f: string) => JSON.parse(readFileSync(join(QUESTIONS, f), "utf8"));
  if (set === "written") return read("public.json").queries.filter((q: Question) => q.type !== "none");
  if (set === "unanswerable") return read("public.json").queries.filter((q: Question) => q.type === "none");
  if (set === "near-miss") return read("near-miss.json").queries;
  return read("castlane.json").questions;
}

// ---- matching a chunk to a label -----------------------------------------------

type Ranked = { docId: string; start: number; end: number };

export class Labels {
  private docs: Map<string, { text: string }>;
  private sections = new Map<string, Section[]>();
  constructor(docs: { id: string; text: string }[]) {
    this.docs = new Map(docs.map((d) => [d.id, d]));
  }
  static fromCorpus() {
    return new Labels([...loadKubernetesDocs(), ...loadAlertRunbooks(), ...loadCastlane()]);
  }
  sectionsOf(docId: string) {
    if (!this.sections.has(docId)) this.sections.set(docId, sectionsOf(this.docs.get(docId) ?? { text: "" }));
    return this.sections.get(docId)!;
  }
  passage(c: Ranked) {
    return this.docs.get(c.docId)?.text.slice(c.start, c.end) ?? "";
  }
  matches(c: Ranked, t: Target): boolean {
    if (c.docId !== t.doc) return false;
    if (t.section && !this.sectionsOf(t.doc).some((s) => s.slug === t.section && c.start < s.end && c.end > s.start)) return false;
    if (t.contains && !this.passage(c).toLowerCase().includes(t.contains.toLowerCase())) return false;
    return true;
  }
  relevant(c: Ranked, q: Question) {
    return q.targets.some((alts) => alts.some((t) => this.matches(c, t)));
  }
}

export const KS = [1, 3, 5, 10, 20] as const;
export type Score = { id: string; type: string; asker?: string; recall: Record<number, number>; rr: number; firstRank: number };

// recall at k: the share of a question's targets found in the top k.
// reciprocal rank: 1 / the rank of the first right chunk (0 if none in the list).
export function scoreQuestion(labels: Labels, q: Question, ranked: Ranked[]): Score {
  const recall: Record<number, number> = {};
  for (const k of KS) {
    const top = ranked.slice(0, k);
    recall[k] = q.targets.filter((alts) => top.some((c) => alts.some((t) => labels.matches(c, t)))).length / q.targets.length;
  }
  const first = ranked.findIndex((c) => labels.relevant(c, q));
  return { id: q.id, type: q.type, asker: q.asker, recall, rr: first >= 0 ? 1 / (first + 1) : 0, firstRank: first >= 0 ? first + 1 : -1 };
}

export function summarize(scores: Score[]) {
  const mean = (f: (s: Score) => number) => scores.reduce((a, s) => a + f(s), 0) / (scores.length || 1);
  const row: Record<string, number> = {};
  for (const k of KS) row[`R@${k}`] = mean((s) => s.recall[k]);
  row.MRR = mean((s) => s.rr);
  return row;
}

// Moved up, moved down: count questions, not averages. A rank of -1 (not in
// the list) counts as last.
export function movedUpDown(before: Record<string, number>, after: Record<string, number>, line = 5) {
  const r = (x: number) => (x < 0 ? Infinity : x);
  let up = 0, down = 0, same = 0, cameIn = 0, fellOut = 0;
  for (const id of Object.keys(after)) {
    if (!(id in before)) continue;
    const b = r(before[id]), a = r(after[id]);
    if (a < b) up++;
    else if (a > b) down++;
    else same++;
    if (b > line && a <= line) cameIn++;
    if (b <= line && a > line) fellOut++;
  }
  return { up, down, same, cameIn, fellOut };
}

// ---- running a leg over a set ---------------------------------------------------

export type Leg = "vector";

// The top 50: enough for recall at 20 and for a reciprocal rank.
export async function retrieve(leg: Leg, q: Question): Promise<Hit[]> {
  return vectorSearch(await embedQuestion(q.q), 50);
}

export async function runSet(set: SetName, leg: Leg, labels: Labels) {
  const questions = loadQuestions(set).filter((q) => q.targets.length);
  const scores: Score[] = [];
  for (const q of questions) scores.push(scoreQuestion(labels, q, await retrieve(leg, q)));
  return { scores };
}

const fmt = (row: Record<string, number>) => Object.entries(row).map(([k, v]) => `${k} ${v.toFixed(3)}`).join("  ");
const ranksOf = (scores: Score[]) => Object.fromEntries(scores.map((s) => [s.id, s.firstRank]));

export function report(name: string, scores: Score[]) {
  console.log(`${name} (${scores.length}): ${fmt(summarize(scores))}`);
  const by = (key: (s: Score) => string | undefined, label: string) => {
    const groups = Map.groupBy(scores, (s) => key(s) ?? "-");
    if (groups.size > 1) console.log(`  by ${label}: ${[...groups].map(([g, ss]) => `${g} ${summarize(ss)["R@5"].toFixed(3)} (${ss.length})`).join(", ")}  (R@5)`);
  };
  by((s) => s.type, "type");
  by((s) => s.asker, "asker");
}

// ---- the command line ------------------------------------------------------------

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      set: { type: "string", default: "written" },
      leg: { type: "string", default: "vector" },
      save: { type: "string" },
      against: { type: "string" },
    },
  });
  const labels = Labels.fromCorpus();
  const sets = values.set!.split(",") as SetName[];
  const leg = values.leg as Leg;
  const results: Record<string, { scores: Score[] }> = {};
  for (const set of sets) {
    const r = await runSet(set, leg, labels);
    results[set] = r;
    report(`${set}, ${leg}`, r.scores);
    if (set === "castlane") console.log(`  first ranks: ${r.scores.map((s) => `${s.id} ${s.firstRank < 0 ? "-" : s.firstRank}`).join(", ")}`);
  }
  const file = (name: string) => join("runs", `${name}.json`);
  if (values.against) {
    if (!existsSync(file(values.against))) throw new Error(`no saved run ${file(values.against)}: score it first with --save ${values.against}`);
    const base = JSON.parse(readFileSync(file(values.against), "utf8"));
    for (const set of sets) {
      if (!base[set]) continue;
      const m = movedUpDown(base[set].ranks, ranksOf(results[set].scores));
      console.log(`${set} against ${values.against}: ${m.up} moved up, ${m.down} moved down, ${m.same} same; top-five line: ${m.cameIn} in, ${m.fellOut} out`);
    }
  }
  if (values.save) {
    mkdirSync("runs", { recursive: true });
    const saved = Object.fromEntries(sets.map((s) => [s, { leg, ranks: ranksOf(results[s].scores), summary: summarize(results[s].scores) }]));
    writeFileSync(file(values.save), JSON.stringify(saved, null, 2) + "\n");
    console.log(`saved ${file(values.save)}`);
  }
  await pool.end();
}
