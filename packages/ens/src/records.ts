/** ENS text-record keys a Sangam merchant publishes. */
export const MERCHANT_TEXT_KEYS = {
  endpoint: "url",
  hederaPayTo: "sangam.payTo",
  network: "sangam.network",
  priceInrPaise: "sangam.priceInrPaise",
  upiHandle: "sangam.upi",
} as const;

export type MerchantField = keyof typeof MERCHANT_TEXT_KEYS;
export const MERCHANT_FIELDS = Object.keys(MERCHANT_TEXT_KEYS) as MerchantField[];

/**
 * Optional record: "verified" once Sangam has checked the merchant, "suspended"
 * to stop agents paying it. Agents that only pay verified merchants read this.
 */
export const STATUS_TEXT_KEY = "sangam.status";

export type MerchantStatus = "verified" | "suspended";

/**
 * Optional record: how much the merchant's agent will haggle down from its
 * published price, in basis points (500 = 5%). The floor an agreed price may
 * reach is priceInrPaise × (1 − bargain/10000). Missing → DEFAULT_BARGAIN_BPS.
 * Capped so bargaining can only ever be a discount below the ENS price, which
 * keeps the "never bill above the ENS price" guarantee intact.
 */
export const BARGAIN_TEXT_KEY = "sangam.bargain";
export const DEFAULT_BARGAIN_BPS = 500;
export const MAX_BARGAIN_BPS = 5000;

/** Parse a sangam.bargain text value (a bps integer, or a "5" / "5%" percent) to clamped bps. */
export function parseBargainBps(value: string | null | undefined): number {
  if (!value) return DEFAULT_BARGAIN_BPS;
  const raw = value.trim().replace(/%$/, "");
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_BARGAIN_BPS;
  // A small number like "5" means 5%; a larger one is already bps.
  const bps = n <= 100 ? Math.round(n * 100) : Math.round(n);
  return Math.max(0, Math.min(MAX_BARGAIN_BPS, bps));
}

/**
 * The standard ENS address record (ENSIP-9, coin type 60) for the merchant's
 * EVM deposit address, so any wallet resolves "bakery.sangam.eth" to it.
 */
export const EVM_COIN_TYPES = [60n] as const;
