/** Types shared by the API routes and the dashboard. The one copy lives in packages/shared. */
export type { EnsView, Invoice, Quote, Settlement, SettlementStatus, Stats } from "@sangam/shared";

/** GET /api/receipts: verification of the HCS receipt chain from the Mirror Node. */
export type ReceiptChain = {
  enabled: boolean;
  topicId: string;
  length: number;
  intact: boolean;
  brokenAtSeq: number | null;
  head: { seq: number; hash: string } | null;
  lagging: boolean;
  error: string | null;
};

/** GET /api/auth/me: the signed-in person, as the browser may see them. */
export type Me = {
  role: "merchant" | "user";
  /** A merchant's ENS name; empty for buyers. */
  label: string;
  /** Name disclosed by the Self proof, if any. */
  name: string | null;
  /** 1 = passport, 2 = EU ID card, 3 = Aadhaar. */
  attestationId: number;
  verifiedAt: string;
  /** Merchants: a password is set, so they can sign in with name + password too. */
  hasPassword: boolean;
  cert: {
    companyName: string;
    registrationNumber: string;
    fileName: string;
    uploadedAt: string;
    status: "submitted";
  } | null;
  /** Merchants: what Sangam set up on Hedera and ENS. */
  shop: {
    upiHandle: string;
    priceInrPaise: number;
    /** ± haggling band published as sangam.bargain, in bps of the price. */
    bargainBps?: number;
    endpoint: string | null;
    depositAccountId: string | null;
    /** Set once the merchant owns its ENS name (token in its wallet, its own resolver). */
    owned?: { owner: string; resolver: string; at: string } | null;
    publishedUrl: string | null;
    ensTxs: { step: string; tx: string }[];
    provisionedAt: string | null;
    error: string | null;
  } | null;
  /** Where this person's desk is. */
  home: string;
  /** Buyers: the agent's own Hedera wallet, once connected. */
  wallet: { accountId: string; createdAt: string; fundedAtomic: string } | null;
  /** The other role this browser has proven with Self, for one-click switching. */
  switchTo: "merchant" | "user" | null;
};
