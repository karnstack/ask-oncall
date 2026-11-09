import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode } from "gpt-tokenizer/encoding/cl100k_base";
import { chunkFixed, countTokens } from "../src/chunk.ts";

const words = (n: number, w = "word") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");

test("fixed chunks overlap and cover the whole text", () => {
  const doc = { id: "d", title: "D", text: words(1200) };
  const chunks = chunkFixed(doc, 512, 64);
  assert.ok(chunks.length >= 3);
  assert.deepEqual(chunks.map((c) => c.id), chunks.map((_, n) => `d::${n}`));
  assert.ok(chunks.every((c) => countTokens(c.body) <= 512));
  // the next window starts 64 tokens before this one ends
  const tokens = encode(doc.text);
  assert.equal(chunks[1].body, decode(tokens.slice(448, 960)));
});
