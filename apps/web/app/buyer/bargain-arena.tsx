"use client";

import { rupees } from "../dashboard/format";

/*
 * Bargaining as a tug-of-war, not a chat log. Two agents face off; the buyer's
 * bid pushes up from the floor while the merchant's ask drops from the list
 * price, and the rope between them shrinks until they snap to the agreed price.
 * Driven by `shown` (how many offer turns are revealed) so the caller controls
 * the reveal animation; markers slide via CSS transitions.
 */

export type Turn = { by: "buyer" | "merchant"; offerPaise: number; message: string };
export type BargainData = {
  listPaise: number;
  floorPaise: number;
  agreedPaise: number;
  savedPaise: number;
  savedBps: number;
  usedModel: boolean;
  rounds: Turn[];
};

export function BargainArena({ data, shown, done }: { data: BargainData; shown: number; done: boolean }) {
  const revealed = data.rounds.slice(0, Math.max(1, shown));
  const lastBuyer = [...revealed].reverse().find((r) => r.by === "buyer");
  const lastMerchant = [...revealed].reverse().find((r) => r.by === "merchant");
  const buyerTurns = data.rounds.filter((r) => r.by === "buyer").length;
  const buyerShown = revealed.filter((r) => r.by === "buyer").length;

  // stable track bounds: lowest bid (buyers can lowball below the floor) → list
  const lowestBid = Math.min(data.floorPaise, ...data.rounds.filter((r) => r.by === "buyer").map((r) => r.offerPaise));
  const min = lowestBid;
  const max = data.listPaise;
  const pos = (p: number) => (max === min ? 50 : Math.max(0, Math.min(100, ((p - min) / (max - min)) * 100)));

  const buyerPaise = done ? data.agreedPaise : lastBuyer?.offerPaise ?? min;
  const merchantPaise = done ? data.agreedPaise : lastMerchant?.offerPaise ?? max;
  const buyerPos = pos(buyerPaise);
  const merchantPos = pos(merchantPaise);
  const floorPos = pos(data.floorPaise);

  const AgentCard = ({ side }: { side: "buyer" | "merchant" }) => {
    const buyer = side === "buyer";
    const turn = buyer ? lastBuyer : lastMerchant;
    const offer = done ? data.agreedPaise : turn?.offerPaise;
    return (
      <div className={`flex-1 rounded-2xl border p-3 ${buyer ? "border-accent/40 bg-accentbg/30" : "border-warn/40 bg-warnbg/40"}`}>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-surface text-lg shadow">{buyer ? "🤖" : "🧑‍🍳"}</span>
          <div className="min-w-0">
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${buyer ? "text-accent" : "text-warn"}`}>{buyer ? "Buyer agent" : "Merchant agent"}</p>
            <p className="truncate text-[10px] text-muted">{buyer ? "wants a discount" : "holds the price"}</p>
          </div>
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{offer != null ? rupees(offer) : "—"}</p>
        {turn && <p className="mt-1 line-clamp-2 min-h-[2.2em] text-xs text-muted">“{turn.message}”</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-stretch gap-2">
        <AgentCard side="buyer" />
        <div className="flex flex-col items-center justify-center px-1 text-center">
          <span className="text-lg">{done ? "🤝" : "⚔︎"}</span>
          <span className="mt-0.5 text-[10px] text-muted">{done ? "deal" : `${Math.min(buyerShown + (lastMerchant && buyerShown < buyerTurns ? 1 : 0), buyerTurns) || 1}/${buyerTurns}`}</span>
        </div>
        <AgentCard side="merchant" />
      </div>

      {/* tug-of-war track */}
      <div>
        <div className="mb-1 flex justify-between text-[11px] text-muted">
          <span>floor {rupees(data.floorPaise)}</span>
          <span>list {rupees(data.listPaise)}</span>
        </div>
        <div className="relative h-12 rounded-xl bg-surface2">
          {/* floor marker */}
          <div className="absolute inset-y-0 w-px bg-line" style={{ left: `${floorPos}%` }} />
          {/* the rope: the span still being fought over */}
          <div
            className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-all duration-700 ${done ? "bg-ok" : "bg-gradient-to-r from-accent to-warn"}`}
            style={{ left: `${Math.min(buyerPos, merchantPos)}%`, width: `${Math.abs(merchantPos - buyerPos)}%` }}
          />
          {/* buyer marker (pushes up from below) */}
          <div className="absolute bottom-0 flex -translate-x-1/2 flex-col items-center transition-all duration-700" style={{ left: `${buyerPos}%` }}>
            <span className={`mb-0.5 rounded px-1 text-[9px] font-bold ${done ? "bg-ok text-white dark:text-[#0b0d1a]" : "bg-accent text-white dark:text-[#0b0d1a]"}`}>🤖</span>
            <span className={`h-5 w-0.5 ${done ? "bg-ok" : "bg-accent"}`} />
          </div>
          {/* merchant marker (drops down from above) */}
          <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center transition-all duration-700" style={{ left: `${merchantPos}%` }}>
            <span className={`h-5 w-0.5 ${done ? "bg-ok" : "bg-warn"}`} />
            <span className={`mt-0.5 rounded px-1 text-[9px] font-bold ${done ? "bg-ok text-white dark:text-[#0b0d1a]" : "bg-warn text-white dark:text-[#0b0d1a]"}`}>🧑‍🍳</span>
          </div>
        </div>
      </div>

      {done && (
        <div className="rounded-2xl bg-okbg px-4 py-3 text-center">
          <p className="text-sm font-semibold text-ok">🤝 Deal at {rupees(data.agreedPaise)}</p>
          <p className="mt-0.5 text-xs text-ok/90">saved {rupees(data.savedPaise)} · {(data.savedBps / 100).toFixed(1)}% off the list price{data.usedModel ? " · decided by 0G" : ""}</p>
        </div>
      )}
    </div>
  );
}
