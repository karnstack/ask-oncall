import { test } from "node:test";
import assert from "node:assert/strict";
import { Labels, movedUpDown, recallWithinBudget, scoreQuestion, summarize, twoSetRule, type Question } from "../tools/score.ts";

const text = "# Pods\n\nIntro.\n\n## Pod fault recovery\n\nNodes fail.\n\n## Disruptions\n\nA PodDisruptionBudget keeps a minimum number of replicas.";
const labels = new Labels([{ id: "pods", text }]);
const at = (phrase: string) => ({ docId: "pods", start: text.indexOf(phrase), end: text.indexOf(phrase) + phrase.length, body: phrase });
const q: Question = { id: "nl11", type: "nl", q: "minimum replicas during voluntary disruptions", targets: [[{ doc: "pods", section: "disruptions", contains: "PodDisruptionBudget" }]] };

test("a label names a document, a section and a phrase, never a chunk id", () => {
  assert.ok(labels.matches(at("A PodDisruptionBudget keeps"), q.targets[0][0]));
  assert.ok(!labels.matches(at("Nodes fail."), q.targets[0][0]), "wrong section");
  assert.ok(!labels.matches({ ...at("A PodDisruptionBudget keeps"), docId: "other" }, q.targets[0][0]), "wrong document");
});

test("recall at five and reciprocal rank for one question", () => {
  const ranked = [...Array.from({ length: 9 }, () => at("Nodes fail.")), at("A PodDisruptionBudget keeps")];
  const s = scoreQuestion(labels, q, ranked);
  assert.equal(s.recall[5], 0);
  assert.equal(s.recall[10], 1);
  assert.equal(s.rr, 1 / 10);
  assert.equal(s.firstRank, 10);
  assert.equal(summarize([s, { ...s, rr: 1, recall: { 1: 1, 3: 1, 5: 1, 10: 1, 20: 1 } }])["R@5"], 0.5);
});

test("recall within a token budget fills in rank order and stops at the first chunk that does not fit", () => {
  const long = "# Big\n\n" + "word ".repeat(3000);
  const both = new Labels([{ id: "pods", text }, { id: "big", text: long }]);
  const big = { docId: "big", start: 0, end: long.length }; // about 3,000 tokens
  const mid = { docId: "big", start: 0, end: 7 + 5 * 1500 }; // about 1,500 tokens
  assert.equal(recallWithinBudget(both, q, [big, at("A PodDisruptionBudget keeps")], 2000), 0);
  assert.equal(recallWithinBudget(both, q, [mid, at("A PodDisruptionBudget keeps")], 2000), 1);
});

test("moved up, moved down, and the top-five line", () => {
  const m = movedUpDown({ a: 10, b: 2, c: -1, d: 3 }, { a: 1, b: 7, c: 4, d: 3 });
  assert.deepEqual(m, { up: 2, down: 1, same: 1, cameIn: 2, fellOut: 1 });
});

test("the two-set rule", () => {
  assert.equal(twoSetRule({ before: 0.802, after: 0.865, n: 48 }, { before: 0.76, after: 0.79 }).keep, true);
  assert.equal(twoSetRule({ before: 0.813, after: 0.792, n: 48 }, { before: 0.83, after: 0.855 }).keep, true, "one written question is noise");
  assert.equal(twoSetRule({ before: 0.833, after: 0.75, n: 48 }, { before: 0.83, after: 0.9 }).keep, false, "four written questions lost");
  assert.equal(twoSetRule({ before: 0.833, after: 0.844, n: 48 }, { before: 0.855, after: 0.83 }).keep, false, "generated drops");
});
