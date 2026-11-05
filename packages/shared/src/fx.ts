import { envOr } from "./config.ts";

const CACHE_MS = 60_000;
let cached: { rate: number; at: number } | null = null;

/**
 * INR per USD, used as INR per USDC (USDC is treated as 1:1 with USD).
 * Falls back to FX_FALLBACK_INR_PER_USD if the rate API is unreachable.
 */
export async function inrPerUsd(): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rate;
  try {
    const res = await fetch(envOr("FX_API_URL", "https://open.er-api.com/v6/latest/USD"), {
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json()) as { rates?: Record<string, number> };
    const rate = body.rates?.INR;
    if (!rate) throw new Error("no INR rate in response");
    cached = { rate, at: Date.now() };
    return rate;
  } catch (err) {
    const fallback = Number(envOr("FX_FALLBACK_INR_PER_USD", "88"));
    console.warn(`[fx] rate API failed (${(err as Error).message}); using fallback ${fallback}`);
    return fallback;
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
