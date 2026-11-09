// The one OpenAI client, and the two ways the code calls a model: a plain
// response, and a streamed one for answers. Every call is priced (ledger.ts).
import OpenAI from "openai";
import type { ResponseUsage } from "openai/resources/responses/responses";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import { PRICES } from "./config.ts";
import { assertBudget, record, type Usage } from "./ledger.ts";

let client: OpenAI | undefined;
export const openai = () => (client ??= new OpenAI()); // reads OPENAI_API_KEY

const usageOf = (u: ResponseUsage | undefined): Usage => ({
  input: u?.input_tokens ?? 0,
  cached: u?.input_tokens_details?.cached_tokens ?? 0,
  output: u?.output_tokens ?? 0,
});

// Refuse to start if the input alone would cross the budget.
function guard(model: string, input: string) {
  assertBudget((countTokens(input) * PRICES[model].input) / 1_000_000);
}

export async function respond(stage: string, model: string, input: string) {
  guard(model, input);
  const t0 = performance.now();
  const res = await openai().responses.create({ model, input, reasoning: { effort: "none" }, store: false });
  const usage = usageOf(res.usage);
  return { text: res.output_text, usage, usd: record(stage, model, usage), ms: performance.now() - t0 };
}

export async function respondStream(stage: string, model: string, input: string, onDelta?: (s: string) => void) {
  guard(model, input);
  const t0 = performance.now();
  const stream = await openai().responses.create({ model, input, reasoning: { effort: "none" }, store: false, stream: true });
  let text = "";
  let firstTokenMs = 0;
  let usage: Usage = { input: 0, cached: 0, output: 0 };
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      if (!firstTokenMs) firstTokenMs = performance.now() - t0;
      text += event.delta;
      onDelta?.(event.delta);
    } else if (event.type === "response.completed") usage = usageOf(event.response.usage);
  }
  return { text, usage, usd: record(stage, model, usage), firstTokenMs, ms: performance.now() - t0 };
}
