import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, envOr } from "@sangam/shared";

const FILE = path.join(DATA_DIR, "agent-budget.local.json");

/*
 * The buyer agent's cumulative spending budget (CUSTOMER_TOTAL_BUDGET, in
 * USDC, e.g. "25" or "$25"). The SDK's maxAmountPerPayment caps one payment;
 * this caps all of them, persisted across restarts in a small ledger the same
 * way the settlement store is. Writes go through one promise chain on
 * globalThis, so two concurrent purchases can't both pass the check.
 */

export class BudgetExceededError extends Error {
  constructor(
    public spentAtomic: string,
    public limitAtomic: string,
    public remainingAtomic: string,
  ) {
    super(`agent budget exhausted: spent ${Number(spentAtomic) / 1e6} of ${Number(limitAtomic) / 1e6} USDC`);
    this.name = "BudgetExceededError";
  }
}

type BudgetLedger = { entries: { tx: string; amountAtomic: string; at: string }[] };

const g = globalThis as unknown as { __sangamBudget?: { lock: Promise<unknown> } };
const state = (g.__sangamBudget ??= { lock: Promise.resolve() });

/** The cumulative limit in atomic units, or null when CUSTOMER_TOTAL_BUDGET is unset. */
export function budgetLimitAtomic(): bigint | null {
  const raw = envOr("CUSTOMER_TOTAL_BUDGET", "").trim();
  if (!raw) return null;
  const usdc = Number(raw.replace(/^\$/, ""));
  if (!Number.isFinite(usdc) || usdc < 0) return null;
  return BigInt(Math.round(usdc * 1e6));
}

function readLedger(): BudgetLedger {
  if (!existsSync(FILE)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as BudgetLedger;
  } catch {
    return { entries: [] };
  }
}

async function writeLedger(ledger: BudgetLedger) {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(ledger, null, 2));
  await rename(`${FILE}.tmp`, FILE);
}

async function withLock<T>(fn: (ledger: BudgetLedger) => T | Promise<T>): Promise<T> {
  const run = state.lock.then(async () => {
    const ledger = readLedger();
    const result = await fn(ledger);
    await writeLedger(ledger);
    return result;
  });
  state.lock = run.catch(() => undefined);
  return run;
}

export async function budgetSpentAtomic(): Promise<bigint> {
  return readLedger()
    .entries.reduce((sum, e) => sum + BigInt(e.amountAtomic || 0), 0n);
}

export async function budgetRemainingAtomic(): Promise<bigint | null> {
  const limit = budgetLimitAtomic();
  if (limit === null) return null;
  return limit - (await budgetSpentAtomic());
}

/** Throws BudgetExceededError when the price wouldn't fit in the remaining budget. */
export async function assertBudgetAllows(priceAtomic: bigint): Promise<void> {
  const limit = budgetLimitAtomic();
  if (limit === null) return;
  const spent = await budgetSpentAtomic();
  if (limit - spent < priceAtomic) {
    throw new BudgetExceededError(spent.toString(), limit.toString(), (limit - spent).toString());
  }
}

/** Record a completed purchase against the budget. */
export async function recordBudgetSpend(tx: string, amountAtomic: string): Promise<void> {
  await withLock((ledger) => {
    ledger.entries.push({ tx, amountAtomic, at: new Date().toISOString() });
  });
}

/** Budget snapshot for /api/stats, or null when there is no cap. */
export async function budgetSnapshot() {
  const limit = budgetLimitAtomic();
  if (limit === null) return null;
  const spent = await budgetSpentAtomic();
  const remaining = limit - spent;
  return {
    limitAtomic: limit.toString(),
    spentAtomic: spent.toString(),
    remainingAtomic: (remaining > 0n ? remaining : 0n).toString(),
  };
}
