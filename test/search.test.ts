import { test } from "node:test";
import assert from "node:assert/strict";
import { rrf, whereSql } from "../src/search.ts";

test("rrf adds 1 / (60 + rank) from each list", () => {
  const vector = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const word = [{ id: "c" }, { id: "a" }];
  const fused = rrf([vector, word], 60);
  assert.deepEqual(fused.map((h) => h.id), ["a", "c", "b"]);
  assert.equal(fused[0].score, 1 / 61 + 1 / 62);
  assert.equal(fused[2].score, 1 / 62);
});

test("rank 1 and rank 10 are close with k = 60, far apart with k near 0", () => {
  const one = [{ id: "x" }], ten = Array.from({ length: 10 }, (_, i) => ({ id: i === 9 ? "y" : `f${i}` }));
  assert.ok(Math.abs(rrf([one], 60)[0].score - 0.0164) < 1e-4);
  assert.ok(Math.abs(rrf([ten], 60).find((h) => h.id === "y")!.score - 0.0143) < 1e-4);
  assert.equal(rrf([ten], 0).find((h) => h.id === "y")!.score, 0.1);
});

test("rrf keeps the top `limit`", () => {
  const list = Array.from({ length: 80 }, (_, i) => ({ id: `c${i}` }));
  assert.equal(rrf([list], 60, 50).length, 50);
});

test("a service named in the question becomes a filter; no filter matches everything", () => {
  assert.deepEqual(whereSql({}, 2), { sql: "true", params: [] });
  assert.deepEqual(whereSql({ service: "pgbouncer-payouts" }, 3), { sql: "$3 = any(c.service)", params: ["pgbouncer-payouts"] });
});
