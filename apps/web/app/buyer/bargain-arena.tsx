"use client";

import { rupees } from "../dashboard/format";

/*
 * Bargaining as a tug-of-war plus the full transcript. Two agents face off;
 * the buyer's bid pushes up from below while the merchant's ask drops from its
 * opening quote (list + margin), and the rope between them shrinks until they
 * snap to the agreed price — always inside the merchant's published ± band
 * [floor = list − margin, ask = list + margin]. Under the track, every offer
 * is shown as a chat bubble tagged with the engine that produced it (0G
 * Compute or the local curve). Driven by `shown` (how many offer turns are
 * revealed) so the caller controls the reveal animation.
 */

export type Turn = { by: "buyer" | "merchant"; offerPaise: number; message: string; via?: "0g" | "local" };
export type OgInfo = { live: boolean; turns: number; verified: boolean; provider: string | null };
export type BargainData = {
  listPaise: number;
  askPaise: number;
  floorPaise: number;
  agreedPaise: number;
  savedPaise: number;
  savedBps: number;
  vsListPaise: number;
  usedModel: boolean;
  ogTurns?: number;
  rounds: Turn[];
};

/** The 0G Compute strip: which engine is deciding the offers, honestly. */
export function OgComputeBadge({ og, data, done }: { og?: OgInfo; data: BargainData | null; done: boolean }) {
  const live = og?.live ?? data?.usedModel ?? false;
  const turns = og?.turns ?? data?.ogTurns ?? 0;
  const verified = og?.verified ?? data?.usedModel ?? false;
  const offers = data ? data.rounds.length - 1 : 0; // minus the opening quote
  const label = !data
    ? live
      ? "0G Compute · agents are reasoning on-chain…"
      : "0G Compute · mock mode — deterministic curve"
    : live && turns > 0
      ? `0G Compute decided ${turns}/${offers} offers${verified ? " · response verified ✓" : ""}`
      : live
        ? "0G Compute unreachable — local curve took over"
        : "0G Compute · mock mode — deterministic curve";
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${live && (turns > 0 || !data) ? "border-accent/40 bg-accentbg/30" : "border-line bg-surface2"}`}>
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${live && (turns > 0 || !data) ? "bg-accent text-white dark:text-[#0b0d1a]" : "bg-surface text-muted"}`}>0G</span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium">{label}</p>
        <p className="truncate text-[10px] text-muted">
          {og?.provider ? `provider ${og.provider.slice(0, 8)}…${og.provider.slice(-4)} · ` : ""}
          every offer is clamped into the merchant&apos;s ± band{done ? " · haggle pinned to HCS with the receipt" : ""}
        </p>
      </div>
    </div>
  );
}

export function BargainArena({ data, shown, done, og }: { data: BargainData; shown: number; done: boolean; og?: OgInfo }) {
  const revealed = data.rounds.slice(0, Math.max(1, shown));
  const lastBuyer = [...revealed].reverse().find((r) => r.by === "buyer");
  const lastMerchant = [...revealed].reverse().find((r) => r.by === "merchant");
  const buyerTurns = data.rounds.filter((r) => r.by === "buyer").length;
  const buyerShown = revealed.filter((r) => r.by === "buyer").length;

  // stable track bounds: lowest bid (buyers can lowball below the floor) → the opening ask
  const lowestBid = Math.min(data.floorPaise, ...data.rounds.filter((r) => r.by === "buyer").map((r) => r.offerPaise));
  const min = lowestBid;
  const max = data.askPaise;
  const pos = (p: number) => (max === min ? 50 : Math.max(0, Math.min(100, ((p - min) / (max - min)) * 100)));

  const buyerPaise = done ? data.agreedPaise : lastBuyer?.offerPaise ?? min;
  const merchantPaise = done ? data.agreedPaise : lastMerchant?.offerPaise ?? max;
  const buyerPos = pos(buyerPaise);
  const merchantPos = pos(merchantPaise);
  const floorPos = pos(data.floorPaise);
  const listPos = pos(data.listPaise);

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
            <p className="truncate text-[10px] text-muted">{buyer ? "wants a discount" : "opened above list"}</p>
          </div>
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{offer != null ? rupees(offer) : "—"}</p>
        {turn && <p className="mt-1 line-clamp-2 min-h-[2.2em] text-xs text-muted">“{turn.message}”</p>}
      </div>
    );
  };

  const vsList = done ? data.vsListPaise ?? data.listPaise - data.agreedPaise : 0;

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

      {/* tug-of-war track across the merchant's published ± band */}
      <div>
        <div className="mb-1 flex justify-between text-[11px] text-muted">
          <span>floor {rupees(data.floorPaise)}</span>
          <span>list {rupees(data.listPaise)}</span>
          <span>ask {rupees(data.askPaise)}</span>
        </div>
        <div className="relative h-12 rounded-xl bg-surface2">
          {/* floor and list-price markers */}
          <div className="absolute inset-y-0 w-px bg-line" style={{ left: `${floorPos}%` }} />
          <div className="absolute inset-y-0 w-px border-l border-dashed border-muted/60" style={{ left: `${listPos}%` }} title={`ENS list price ${rupees(data.listPaise)}`} />
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
          {/* merchant marker (drops down from its opening ask) */}
          <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center transition-all duration-700" style={{ left: `${merchantPos}%` }}>
            <span className={`h-5 w-0.5 ${done ? "bg-ok" : "bg-warn"}`} />
            <span className={`mt-0.5 rounded px-1 text-[9px] font-bold ${done ? "bg-ok text-white dark:text-[#0b0d1a]" : "bg-warn text-white dark:text-[#0b0d1a]"}`}>🧑‍🍳</span>
          </div>
        </div>
      </div>

      {/* the full haggle, offer by offer, tagged with the engine that made it */}
      <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
        {revealed.map((t, i) => {
          const buyer = t.by === "buyer";
          return (
            <div key={i} className={`flex ${buyer ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl border px-3 py-1.5 ${buyer ? "rounded-br-sm border-accent/30 bg-accentbg/30" : "rounded-bl-sm border-warn/30 bg-warnbg/30"}`}>
                <p className="text-xs">{buyer ? "🤖" : "🧑‍🍳"} {t.message}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">
                  <span className="font-semibold tabular-nums">{rupees(t.offerPaise)}</span>
                  <span className={`rounded px-1 text-[9px] font-bold ${t.via === "0g" ? "bg-accent/15 text-accent" : "bg-surface2 text-muted"}`}>
                    {t.via === "0g" ? "0G Compute" : i === 0 ? "ENS quote" : "local curve"}
                  </span>
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <OgComputeBadge og={og} data={data} done={done} />

      {done && (
        <div className="rounded-2xl bg-okbg px-4 py-3 text-center">
          <p className="text-sm font-semibold text-ok">🤝 Deal at {rupees(data.agreedPaise)}</p>
          <p className="mt-0.5 text-xs text-ok/90">
            haggled {rupees(data.savedPaise)} off the opening ask ({(data.savedBps / 100).toFixed(1)}%)
            {vsList > 0 ? ` · ${rupees(vsList)} under the list price` : vsList < 0 ? ` · ${rupees(-vsList)} over list, inside the merchant's ± band` : " · right at the list price"}
            {data.usedModel ? " · decided by 0G" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
