// Every API call is priced from its usage block and appended to one file, and
// a guard refuses to start a step that would take the total past the budget.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { BUDGET_USD, PRICES } from "./config.ts";

export const LEDGER_FILE = ".cache/ledger.jsonl";

export type Usage = { input: number; cached: number; output: number };

export function costOf(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for ${model}: add it to PRICES in src/config.ts`);
  return ((u.input - u.cached) * p.input + u.cached * p.cachedInput + u.output * p.output) / 1_000_000;
}

export function record(stage: string, model: string, usage: Usage): number {
  const usd = costOf(model, usage);
  mkdirSync(dirname(LEDGER_FILE), { recursive: true });
  appendFileSync(LEDGER_FILE, JSON.stringify({ at: new Date().toISOString(), stage, model, ...usage, usd }) + "\n");
  return usd;
}

export function spentSoFar(): number {
  if (!existsSync(LEDGER_FILE)) return 0;
  return readFileSync(LEDGER_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .reduce((sum, line) => sum + JSON.parse(line).usd, 0);
}

export function assertBudget(plannedUsd: number) {
  const spent = spentSoFar();
  if (spent + plannedUsd > BUDGET_USD)
    throw new Error(
      `budget: spent $${spent.toFixed(4)}, this step plans $${plannedUsd.toFixed(4)}, ` +
        `BUDGET_USD is $${BUDGET_USD}. Raise it in .env if you mean to spend more.`,
    );
}
