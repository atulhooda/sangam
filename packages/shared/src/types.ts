/** The single copy of every type shared by the packages, the API and the dashboard. */

/** What a merchant publishes in its ENS text records. */
export type MerchantRecord = {
  ensName: string;
  endpoint: string;
  hederaPayTo: string;
  network: string;
  /** sangam.payTo.whitechain: the merchant's USDT deposit address on Whitechain, when it accepts that rail. */
  whitechainPayTo?: string;
  upiHandle: string;
  priceInrPaise: number;
  /**
   * sangam.status: "verified" once Sangam has checked the merchant (Self proof
   * + company certificate); "suspended" to stop agents paying it. Missing on
   * names issued before verification existed: agents treat those as unverified.
   */
  status?: string;
};

export type SettlementStatus = "received" | "confirmed" | "decided" | "paid" | "held" | "failed";

export type PayoutMode = "mock" | "razorpayx-test";

/** Which chain a payment settled on. Rows from before Whitechain have no rail: they are Hedera. */
export type Rail = "hedera" | "whitechain";

export type Settlement = {
  /** How Sangam learned of the payment: the merchant's x402 notice, or USDC seen landing in its deposit account. */
  source?: "x402" | "transfer";
  /** Hedera (USDC) or Whitechain (USDT). Missing on older rows: Hedera. */
  rail?: Rail;
  id: string;
  merchant: string;
  /** The payment transaction: a Hedera transaction id, or a Whitechain tx hash (0x…) when rail is "whitechain". */
  hederaTxId: string;
  payer: string | null;
  /** Atomic stablecoin units (6 decimals: USDC on Hedera, USDT on Whitechain) actually credited. */
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
  /** Whitechain: the SangamReceipts transaction that recorded this settlement (hcsSequence holds its seq). */
  receiptTx?: string | null;
  /** The price this order was quoted at, when it isn't the merchant's fixed price (ONDC). */
  quotedInrPaise?: number | null;
  /**
   * Refund back to the payer, created when the payment is held: a Hedera
   * scheduled transaction, or a gasless USDT transfer on Whitechain (scheduleId
   * empty, transactionId the tx hash).
   */
  refund?: {
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
  /** Which chain hederaTxId is on. Inferred from its format when missing. */
  rail?: Rail;
  /** The storefront product bought, when the sale was one product. */
  product?: { ensName: string; title: string };
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
  /** The rails payments can settle on right now. */
  rails?: Rail[];
  /** The Whitechain rail, when it's on: receipts contract, its chain tip, the relayer and the agent's address. */
  whitechain?: {
    receiptsContract: string | null;
    receiptsCount: number | null;
    receiptsHead: string | null;
    relayer: string;
    customerAddress: string | null;
  } | null;
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
