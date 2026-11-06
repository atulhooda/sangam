/** The single copy of every type shared by the packages, the API and the dashboard. */

/** What a merchant publishes in its ENS text records. */
export type MerchantRecord = {
  ensName: string;
  endpoint: string;
  hederaPayTo: string;
  network: string;
  /** The name's standard address record (coin type 60): where any wallet sends when you type the name. */
  evmPayTo?: string;
  upiHandle: string;
  priceInrPaise: number;
  /**
   * sangam.status: "verified" once Sangam has checked the merchant (Self proof
   * + company certificate); "suspended" to stop agents paying it. Missing on
   * names issued before verification existed: agents treat those as unverified.
   */
  status?: string;
  /**
   * sangam.bargain: how far the merchant's agent will haggle below priceInrPaise,
   * in basis points (500 = 5%). resolveMerchant fills the default when the record
   * is absent, so this is always set after a lookup.
   */
  bargainBps?: number;
};

export type SettlementStatus = "received" | "confirmed" | "decided" | "paid" | "held" | "failed";

export type PayoutMode = "mock" | "razorpayx-test" | "cashfree-sandbox" | "cashfree";

/** Which chain a payment settled on: Hedera (x402), or Sepolia (the buyer's own wallet). Missing on older rows: Hedera. */
export type Rail = "hedera" | "sepolia";

export type Settlement = {
  /** How Sangam learned of the payment: the merchant's x402 notice, or USDC seen landing in its deposit account. */
  source?: "x402" | "transfer";
  /** Hedera (USDC over x402) or Sepolia (USDC from the buyer's own MetaMask). Missing on older rows: Hedera. */
  rail?: Rail;
  id: string;
  merchant: string;
  /** The payment transaction: a Hedera transaction id, or a Sepolia tx hash (0x…) when rail is "sepolia". */
  hederaTxId: string;
  payer: string | null;
  /** Atomic USDC units (6 decimals) actually credited. */
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
  /** Sandbox payouts (Cashfree) go to a test UPI ID standing in for the merchant's: the one actually paid. */
  payoutTo?: string | null;
  hcsSequence: number | null;
  /** Set when the payment was checked on the Mirror Node (false: check skipped). */
  chainVerified?: boolean;
  /** HCS topic the receipt went to, so the dashboard can link it. */
  hcsTopicId?: string | null;
  /** The price this order was quoted at, when it isn't the merchant's fixed price (ONDC). */
  quotedInrPaise?: number | null;
  /** Refund back to the payer, created when the payment is held: a Hedera scheduled transaction. */
  refund?: {
    /** "sepolia": a gasless USDC transfer back to the buyer's wallet (scheduleId empty). */
    rail?: Rail;
    scheduleId: string;
    transactionId: string;
    amountAtomic: string;
    payer: string;
    createdAt: string;
  } | null;
  /** Set when the payment bought an order on ONDC. */
  ondc?: OndcOrderInfo | null;
  /** Set when the payment bought one product from the merchant's storefront (its own ENS name). */
  product?: { ensName: string; title: string } | null;
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
  /** Per-order quote (ONDC); falls back to the merchant's ENS price. */
  quotedInrPaise?: number;
  ondc?: OndcOrderInfo;
  /** "x402" (the merchant's notice, the default) or "transfer" (Sangam saw USDC land in the merchant's deposit account). */
  source?: "x402" | "transfer";
  /** The storefront product bought, when the sale was one product. */
  product?: { ensName: string; title: string };
  /** "sepolia" when the buyer's own wallet paid (hederaTxId is then a Sepolia tx hash). */
  rail?: Rail;
};

/** The ONDC side of a settlement: which seller, which order, where the rupees go. */
export type OndcOrderInfo = {
  transactionId: string;
  orderId: string;
  state: string;
  bppId: string;
  bppUri: string;
  providerId: string;
  providerName: string;
  items: { id: string; name: string; count: number }[];
  quoteInrPaise: number;
  /** Seller's UPI from the on_init settlement details. */
  sellerUpi: string;
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
  /** The buyer agent's cumulative budget, or null when CUSTOMER_TOTAL_BUDGET is unset. */
  budget?: { limitAtomic: string; spentAtomic: string; remainingAtomic: string } | null;
  /** The buyer agent's Hedera account (CUSTOMER_ACCOUNT_ID), when set. */
  customerAccountId?: string | null;
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

/** GET /api/ens: a merchant's ENS identity as the dashboard shows it. */
export type EnsView = {
  name: string;
  parent: string;
  source: "ens" | "offline";
  records: { key: string; value: string }[];
  registry: string | null;
  resolver: string | null;
  links: { app: string; registry: string | null; resolver: string | null };
};
