import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, principalsOf, userByHandle } from "../src/access.ts";

test("principals: everyone, the person, and their groups", () => {
  assert.deepEqual(principalsOf({ handle: "ext-rb", groups: ["contractors"] }), ["everyone", "user:ext-rb", "contractors"]);
  assert.deepEqual(principalsOf(userByHandle("jh")), ["everyone", "user:jh", "eng", "payouts-eng"]);
});

test("the cache key carries the asker's scope and the index version", () => {
  const lead = principalsOf(userByHandle("sec-lead"));
  const contractor = principalsOf(userByHandle("ext-rb"));
  const q = "What is pf-app-2026.09.10?";
  assert.notEqual(cacheKey(q, lead, 7), cacheKey(q, contractor, 7), "two askers never share an entry");
  assert.notEqual(cacheKey(q, lead, 7), cacheKey(q, lead, 8), "a new index version misses");
  assert.equal(cacheKey(q, lead, 7), cacheKey("  what is PF-APP-2026.09.10? ", [...lead].reverse(), 7), "same question, same principals");
});
