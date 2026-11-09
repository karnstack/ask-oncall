import { test } from "node:test";
import assert from "node:assert/strict";
import { findNearCopies, jaccard, shingles } from "../src/duplicates.ts";

test("word 5-grams and Jaccard", () => {
  const a = shingles("repmgr -f /etc/repmgr.conf standby switchover --siblings-follow");
  assert.ok(a.has("repmgr -f etc repmgr.conf standby"), "punctuation splits words");
  assert.equal(jaccard(a, a), 1);
  assert.equal(jaccard(a, shingles("patronictl switchover pg-feeds --leader pg-feeds-0 --candidate pg-feeds-1")), 0);
});

const step = (n: number, cmd: string) => `Step ${n}. On the leader run ${cmd} and wait for the replica to report streaming before you continue with the next step of the procedure.`;
const v2 = Array.from({ length: 8 }, (_, i) => step(i, "repmgr standby switchover"));

test("a copy in another source is found; its own reference and unrelated pages are not", () => {
  const wiki = [...v2.slice(0, 7), "This page was exported from the old wiki in 2024 and is no longer maintained by anyone at all."];
  const v3 = Array.from({ length: 8 }, (_, i) => `Patroni ${i}: use patronictl to move the leader, then check the lag on every replica and post in the incident channel.`);
  const copies = findNearCopies([{ docId: "wiki", chunks: wiki }, { docId: "v3", chunks: v3 }, { docId: "v2", chunks: v2 }], [{ docId: "v2", chunks: v2 }]);
  assert.deepEqual(copies.map((c) => [c.docId, c.of, c.matched, c.chunks]), [["wiki", "v2", 7, 8]]);
});

test("one shared paragraph does not make a copy", () => {
  const quoting = [v2[4], "The postmortem explains why this command no longer exists after the move to Patroni in June."];
  assert.deepEqual(findNearCopies([{ docId: "inc-1873", chunks: [...quoting, "a", "b"] }], [{ docId: "v2", chunks: v2 }]), []);
});
