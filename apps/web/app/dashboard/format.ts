import type { Settlement } from "@/lib/types";

export const usdc = (atomic: string | number, dp = 4) => (Number(atomic) / 1e6).toFixed(dp);

export const rupees = (paise: number, dp = 2) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export const shortId = (s: string, head = 8) => (s.length > head + 2 ? `${s.slice(0, head)}…` : s);

export const shortTx = (s: string) => (s.length > 22 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s);

export function timeAgo(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const isInFlight = (s: Settlement) => s.status === "received" || s.status === "confirmed" || s.status === "decided";

export const hashscanTx = (tx: string) => `https://hashscan.io/testnet/transaction/${encodeURIComponent(tx)}`;
export const hashscanTopic = (topicId: string) => `https://hashscan.io/testnet/topic/${topicId}`;
export const hashscanSchedule = (scheduleId: string) => `https://hashscan.io/testnet/schedule/${scheduleId}`;
export const isSimTx = (tx: string) => tx.startsWith("sim-");

export const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/* ── the rail: USDC on Hedera ── */

/** Hedera: an agent paid over x402. Sepolia: the buyer's own MetaMask paid the shop's ENS name. */
export type Rail = "hedera" | "sepolia";
export const RAIL_NAME: Record<Rail, string> = { hedera: "Hedera", sepolia: "Sepolia" };
export const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";

export const railOf = (s: Pick<Settlement, "rail" | "hederaTxId">): Rail => s.rail ?? "hedera";
export const tokenOf = (_s: Pick<Settlement, "rail" | "hederaTxId">) => "USDC";

/** Explorer link for a transaction on its rail. */
export const explorerTx = (tx: string, rail?: Rail) => (rail === "sepolia" ? `${SEPOLIA_EXPLORER}/tx/${tx}` : hashscanTx(tx));
/** A settlement's payment transaction on its explorer. */
export const settlementTxUrl = (s: Pick<Settlement, "rail" | "hederaTxId">) => explorerTx(s.hederaTxId, railOf(s));
export const explorerAddress = (address: string) =>
  address.startsWith("0x") ? `${SEPOLIA_EXPLORER}/address/${address}` : `https://hashscan.io/testnet/account/${address}`;
/** "HashScan" or "Etherscan", for a link's label. */
export const explorerName = (url?: string | null) => (url && url.includes("etherscan") ? "Etherscan" : "HashScan");

/** Where the settlement's refund can be seen: a Hedera schedule, or a Sepolia transfer back to the buyer's wallet. */
export const refundUrl = (r: NonNullable<Settlement["refund"]>) =>
  r.rail === "sepolia" || !r.scheduleId ? explorerTx(r.transactionId, r.rail) : hashscanSchedule(r.scheduleId);

/** Where the settlement's receipt is: an HCS topic message. */
export function receiptLink(s: Settlement): { href: string; label: string } | null {
  if (s.hcsSequence === null) return null;
  if (s.hcsTopicId) return { href: hashscanTopic(s.hcsTopicId), label: `${s.hcsTopicId} #${s.hcsSequence}` };
  return null;
}
