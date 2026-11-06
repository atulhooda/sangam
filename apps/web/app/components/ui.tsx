"use client";

import { useEffect, useState } from "react";
import type { Settlement } from "@/lib/types";
import { Tilt3D } from "./space/kit";
import { RAIL_NAME, type Rail, explorerTx, settlementTxUrl, isInFlight, isSimTx, railOf, receiptLink, refundUrl, shortTx, tokenOf, usdc } from "../dashboard/format";

/* Small shared pieces the settlement, merchant and buyer desks all use. */

/** A glass panel that floats and tilts slightly toward the pointer (3D, but gentle enough to read). */
export function Card({ children, className = "", tilt = 2.5 }: { children: React.ReactNode; className?: string; tilt?: number }) {
  // Grid placement (col-span, row-span) belongs on the outer box, which is the grid item.
  const all = className.split(/\s+/).filter(Boolean);
  const placement = all.filter((c) => /(^|:)(col|row)-span-/.test(c)).join(" ");
  const rest = all.filter((c) => !/(^|:)(col|row)-span-/.test(c)).join(" ");
  return (
    <Tilt3D as="section" max={tilt} className={placement} innerClassName={`glass-3d rounded-2xl ${rest}`}>
      {children}
    </Tilt3D>
  );
}

export function CardHead({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-3 w-3 animate-spin ${className}`} aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Status colours are reserved for state, and always carry an icon + label. */
export function StatusPill({ s }: { s: Settlement }) {
  if (isInFlight(s))
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-infobg px-2.5 py-0.5 text-xs font-medium text-info">
        <Spinner /> Processing
      </span>
    );
  const map = {
    paid: { cls: "bg-okbg text-ok", icon: "✓", label: "Paid" },
    held: { cls: "bg-warnbg text-warn", icon: "‖", label: "Held" },
    failed: { cls: "bg-badbg text-bad", icon: "✕", label: "Failed" },
  } as const;
  const m = map[s.status as keyof typeof map];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${m.cls}`}>
      <span aria-hidden className="font-bold">{m.icon}</span> {m.label}
    </span>
  );
}

export function LedgerRow({ k, v, tone, strong }: { k: React.ReactNode; v: React.ReactNode; tone?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="shrink-0 whitespace-nowrap text-sm text-muted">{k}</span>
      <span className={`min-w-0 truncate text-right text-sm tabular-nums ${strong ? "font-semibold" : ""} ${tone ?? ""}`}>{v}</span>
    </div>
  );
}

export function MockTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-dashed border-warn/50 px-1.5 py-px text-[10px] font-medium text-warn">
      {children}
    </span>
  );
}

/** Which Self credential proved this person: Aadhaar (India) or a passport/EU ID. */
export function idBadge(attestationId: number): { label: string; cls: string } {
  switch (attestationId) {
    case 3:
      return { label: "Aadhaar ✓", cls: "bg-okbg text-ok" };
    case 2:
      return { label: "EU ID ✓", cls: "bg-okbg text-ok" };
    case 4:
      return { label: "KYC ✓", cls: "bg-okbg text-ok" };
    default:
      return { label: "Passport ✓", cls: "bg-okbg text-ok" };
  }
}

/** The proof column's rows a person cares about: tx, refund, receipt. */
export function ProofRows({ s }: { s: Settlement }) {
  const rail = railOf(s);
  const receipt = receiptLink(s);
  return (
    <>
      <LedgerRow
        k={`${RAIL_NAME[rail]} tx`}
        v={
          isSimTx(s.hederaTxId) ? (
            <span className="mono text-xs text-muted" title={s.hederaTxId}>simulated</span>
          ) : (
            <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={settlementTxUrl(s)} target="_blank" rel="noreferrer">
              {shortTx(s.hederaTxId)} ↗
            </a>
          )
        }
      />
      {s.refund && (
        <LedgerRow
          k="Scheduled refund"
          v={
            <a className="mono text-xs text-warn underline-offset-2 hover:underline" href={refundUrl(s.refund)} target="_blank" rel="noreferrer">
              {s.refund.scheduleId || shortTx(s.refund.transactionId)} · {usdc(s.refund.amountAtomic)} {tokenOf(s)} ↗
            </a>
          }
        />
      )}
      <LedgerRow
        k="HCS receipt"
        v={
          receipt ? (
            <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={receipt.href} target="_blank" rel="noreferrer">
              {receipt.label} ↗
            </a>
          ) : (
            <span className="mono text-xs text-muted">{s.hcsSequence !== null ? `#${s.hcsSequence}` : "not set"}</span>
          )
        }
      />
    </>
  );
}

/** A small "Hedera" / "Sepolia" chip for a settlement row. */
export function RailBadge({ s }: { s: Pick<Settlement, "rail" | "hederaTxId"> }) {
  const rail = railOf(s);
  return (
    <span
      className={`mono rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${rail === "sepolia" ? "bg-warnbg text-warn" : "bg-okbg text-ok"}`}
      title={rail === "sepolia" ? "Paid in USDC from the buyer's own wallet (Sepolia)" : "Paid in USDC on Hedera"}
    >
      {RAIL_NAME[rail]}
    </span>
  );
}

/** Lets the person pick which rail the agent pays on. Remembered in this browser. */
export function RailToggle({ rail, onChange, rails }: { rail: Rail; onChange: (r: Rail) => void; rails?: Rail[] }) {
  const options: Rail[] = rails && rails.length > 0 ? rails : ["hedera"];
  if (options.length < 2) return null;
  return (
    <div role="radiogroup" aria-label="Pay on" className="inline-flex items-center gap-1 rounded-full border border-line p-0.5 text-xs">
      {options.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={rail === r}
          onClick={() => onChange(r)}
          className={`rounded-full px-3 py-1 transition-colors ${rail === r ? "bg-accent text-bg" : "text-muted hover:text-ink"}`}
        >
          {r === "sepolia" ? "MetaMask" : RAIL_NAME[r]} · USDC
        </button>
      ))}
    </div>
  );
}

const RAIL_KEY = "sangam.rail";

/** The rail the agent pays on, remembered per browser (falls back to Hedera). */
export function useRail(): [Rail, (r: Rail) => void] {
  const [rail, setRail] = useState<Rail>("hedera");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RAIL_KEY);
      if (saved === "hedera" || saved === "sepolia") setRail(saved);
    } catch {
      /* storage blocked: keep the default */
    }
  }, []);
  const set = (r: Rail) => {
    setRail(r);
    try {
      localStorage.setItem(RAIL_KEY, r);
    } catch {
      /* ignore */
    }
  };
  return [rail, set];
}
