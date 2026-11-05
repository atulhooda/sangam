/** What a merchant publishes in its ENS text records. */
export type MerchantRecord = {
  ensName: string;
  endpoint: string;
  hederaPayTo: string;
  network: string;
  upiHandle: string;
  priceInrPaise: number;
};

export type SettlementStatus = "received" | "confirmed" | "decided" | "paid" | "held" | "failed";

export type Settlement = {
  id: string;
  merchant: string;
  hederaTxId: string;
  payer: string | null;
  /** Atomic USDC units (6 decimals) actually credited to the treasury. */
  usdcAmount: string;
  fxRate: number;
  inrGrossPaise: number;
  feeBps: number | null;
  payoutPaise: number | null;
  decision: "payout" | "hold" | null;
  decisionReason: string | null;
  ogChatId: string | null;
  ogVerified: boolean | null;
  payoutRef: string | null;
  payoutMode: "mock" | "razorpayx-test" | null;
  hcsSequence: number | null;
  status: SettlementStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Body merchant-api sends to settlement-agent after an x402 payment settles. */
export type SettlementNotice = {
  merchant: string;
  hederaTxId: string;
  payer?: string;
  usdcAmount: string;
};
