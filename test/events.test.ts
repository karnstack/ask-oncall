import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { Debouncer, debounceFires, slackDayId } from "../src/events.ts";

test("a burst fires once, after the quiet period", () => {
  const fires = debounceFires([0, 10, 20, 30, 200, 205].map((t) => ({ key: "day", t })), 60);
  assert.deepEqual(fires, [{ key: "day", t: 90 }, { key: "day", t: 265 }]);
});

test("each key has its own timer", () => {
  const fires = debounceFires([{ key: "a", t: 0 }, { key: "b", t: 30 }, { key: "a", t: 50 }], 60);
  assert.deepEqual(fires.map((f) => `${f.key}@${f.t}`).sort(), ["a@110", "b@90"]);
});

test("the live debouncer resets its timer on every event", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const fired: string[] = [];
  const d = new Debouncer(60_000, (k) => fired.push(k));
  d.push("day");
  mock.timers.tick(59_000);
  d.push("day"); // the 03:31:40 "+1" resets the timer
  mock.timers.tick(59_000);
  assert.deepEqual(fired, []);
  mock.timers.tick(1_000);
  assert.deepEqual(fired, ["day"]);
  assert.equal(d.pending, 0);
  mock.timers.reset();
});

test("a message belongs to its channel's UTC day", () => {
  assert.equal(slackDayId("inc-2291", "1792985464.000301"), "slack/inc-2291/2026-10-26.json");
});
