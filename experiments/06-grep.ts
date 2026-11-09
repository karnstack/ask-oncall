// Can plain grep find the right document? For each written question: match
// its content words (case-insensitive, any of them) in every Markdown file,
// rank files by match count, and check whether the labelled document is among
// the first five. No index, no model, no API key.
//   node experiments/06-grep.ts
import { loadAlertRunbooks, loadKubernetesDocs } from "../src/corpus.ts";
import { loadQuestions } from "../tools/score.ts";

const STOP = new Set("a an and are as at be by can do does for from has have how i if in into is it its me my of on or our so that the their them there these this to was what when where which while who why will with would you your should could get gets".split(" "));
const words = (q: string) => [...new Set(q.toLowerCase().replace(/[?,.()"']/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
const docs = [...loadKubernetesDocs(), ...loadAlertRunbooks()].map((d) => ({ id: d.id, text: d.text.toLowerCase() }));
const count = (text: string, w: string) => text.split(w).length - 1;

const rows = loadQuestions("written").map((q) => {
  const ws = words(q.q);
  const t0 = performance.now();
  const ranked = docs.map((d) => ({ id: d.id, n: ws.reduce((s, w) => s + count(d.text, w), 0) })).filter((d) => d.n > 0).sort((a, b) => b.n - a.n);
  const ms = performance.now() - t0;
  const rank = ranked.findIndex((d) => q.targets.some((alts) => alts.some((t) => t.doc === d.id))) + 1;
  const found = q.targets.filter((alts) => alts.some((t) => ranked.slice(0, 5).some((d) => d.id === t.doc))).length / q.targets.length;
  return { id: q.id, type: q.type, files: ranked.length, rank, found, ms };
});
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`plain grep, document-level R@5 on ${rows.length} written questions: ${mean(rows.map((r) => r.found)).toFixed(3)}`);
for (const t of ["nl", "id", "para", "multi"]) console.log(`  ${t} ${mean(rows.filter((r) => r.type === t).map((r) => r.found)).toFixed(3)}`);
console.log(`files matched per question: median ${rows.map((r) => r.files).sort((a, b) => a - b)[Math.floor(rows.length / 2)]}`);
for (const id of ["id01", "pa04", "nl08", "pa09"]) {
  const r = rows.find((x) => x.id === id)!;
  console.log(`  ${id}: the labelled page ranks ${r.rank || "nowhere"} of ${r.files} files`);
}
