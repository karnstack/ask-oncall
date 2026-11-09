import { test } from "node:test";
import assert from "node:assert/strict";
import { principalsOf, userByHandle } from "../src/access.ts";

test("principals: everyone, the person, and their groups", () => {
  assert.deepEqual(principalsOf({ handle: "ext-rb", groups: ["contractors"] }), ["everyone", "user:ext-rb", "contractors"]);
  assert.deepEqual(principalsOf(userByHandle("jh")), ["everyone", "user:jh", "eng", "payouts-eng"]);
});
