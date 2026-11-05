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
