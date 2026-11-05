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
export const isSimTx = (tx: string) => tx.startsWith("sim-");
