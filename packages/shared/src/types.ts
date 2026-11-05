/** The single copy of every type shared by the packages, the API and the dashboard. */

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

export type PayoutMode = "mock" | "razorpayx-test";

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
  payoutMode: PayoutMode | null;
  hcsSequence: number | null;
  /** Set when the payment was checked on the Mirror Node (false: check skipped). */
  chainVerified?: boolean;
  /** HCS topic the receipt went to, so the dashboard can link it. */
  hcsTopicId?: string | null;
  status: SettlementStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Body the merchant sends to Sangam (POST /api/settlements) after an x402 payment settles. */
export type SettlementNotice = {
  merchant: string;
  hederaTxId: string;
  payer?: string;
  usdcAmount: string;
};

export type Stats = {
  count: number;
  paidCount: number;
  heldCount: number;
  usdcInAtomic: string;
  inrPaidOutPaise: number;
  hcsTopicId: string | null;
  /** 0G ledger balance in OG, or null when 0G is mocked or unreachable. */
  ogBalance: string | null;
  /** "simulation" when everything is mocked, "live" when nothing is. */
  mode: "simulation" | "mixed" | "live";
  mocks: { chainVerify: boolean; og: boolean; psp: boolean; ens: boolean; hcs: boolean };
  /** Whether the dashboard's buttons can run. */
  actions: { simulate: boolean; payAsAgent: boolean };
};

export type Quote = {
  merchant: string;
  priceInr: number;
  priceUsdc: string;
  network: string;
  payTo: string;
  upiHandle: string;
  fxRate: number;
  routes: string[];
};

/** x402 v2 PAYMENT-REQUIRED body, as the dashboard reads it. */
export type Invoice = {
  x402Version: number;
  error?: string;
  resource?: { url: string; description: string; mimeType: string };
  accepts: {
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra?: { feePayer?: string };
  }[];
};
