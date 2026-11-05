/** Shared between the API routes and the dashboard. Mirrors packages/shared/src/types.ts. */

export type SettlementStatus = "received" | "confirmed" | "decided" | "paid" | "held" | "failed";

export type Settlement = {
  id: string;
  merchant: string;
  hederaTxId: string;
  payer: string | null;
  /** Atomic USDC units (6 decimals) credited to the treasury. */
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

export type Stats = {
  count: number;
  paidCount: number;
  heldCount: number;
  usdcInAtomic: string;
  inrPaidOutPaise: number;
  hcsTopicId: string | null;
  mode: "simulation";
  mocks: { chainVerify: boolean; og: boolean; psp: boolean; ens: boolean; hcs: boolean };
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
