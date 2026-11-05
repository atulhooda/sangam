import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./store";

/* ── FX (ported from packages/shared/src/fx.ts) ── */

const CACHE_MS = 60_000;
const FALLBACK_INR_PER_USD = 88;
const g = globalThis as unknown as { __sangamFx?: { rate: number; at: number } };

/** INR per USD, used as INR per USDC. Falls back to a fixed rate if the API is down. */
export async function inrPerUsd(): Promise<number> {
  const cached = g.__sangamFx;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rate;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(4_000) });
    const body = (await res.json()) as { rates?: Record<string, number> };
    const rate = body.rates?.INR;
    if (!rate) throw new Error("no INR rate");
    g.__sangamFx = { rate, at: Date.now() };
    return rate;
  } catch {
    return FALLBACK_INR_PER_USD;
  }
}

export const USDC_DECIMALS = 6;

/** Price in paise → USDC atomic units, rounded up so the merchant is never short. */
export function paiseToUsdcAtomic(paise: number, rate: number): bigint {
  return BigInt(Math.ceil((paise / 100 / rate) * 10 ** USDC_DECIMALS));
}

/** USDC atomic units → paise, rounded down. */
export function usdcAtomicToPaise(atomic: bigint, rate: number): number {
  return Math.floor((Number(atomic) / 10 ** USDC_DECIMALS) * rate * 100);
}

export function formatUsdc(atomic: bigint | string): string {
  return (Number(atomic) / 10 ** USDC_DECIMALS).toFixed(USDC_DECIMALS);
}

/* ── Merchant registry (ENS offline: data/merchants.local.json) ── */

export type Merchant = {
  ensName: string;
  endpoint: string;
  hederaPayTo: string;
  network: string;
  upiHandle: string;
  priceInrPaise: number;
};

export const MERCHANT_ENS_NAME = "tickets.sangam.eth";
export const ROUTES = ["CSMT-PUNE", "CSMT-NGP", "BCT-NDLS"];
/** Hedera testnet USDC token and the Blocky402 facilitator's fee payer. */
export const HEDERA_TESTNET_USDC = "0.0.429274";
export const FACILITATOR_FEE_PAYER = "0.0.7162784";

export function resolveMerchant(name = MERCHANT_ENS_NAME): Merchant {
  const file = path.join(REPO_ROOT, "data/merchants.local.json");
  const all = JSON.parse(readFileSync(file, "utf8")) as Record<string, Omit<Merchant, "ensName" | "priceInrPaise"> & { priceInrPaise: string | number }>;
  const m = all[name];
  if (!m) throw new Error(`merchant ${name} not in data/merchants.local.json`);
  return { ...m, ensName: name, priceInrPaise: Number(m.priceInrPaise) };
}
