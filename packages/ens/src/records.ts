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
 * The standard ENS address record (ENSIP-9, coin type 60) for the merchant's
 * EVM deposit address, so any wallet resolves "bakery.sangam.eth" to it.
 */
export const EVM_COIN_TYPES = [60n] as const;
