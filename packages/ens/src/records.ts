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
