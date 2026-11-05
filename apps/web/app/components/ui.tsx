"use client";

import type { Settlement } from "@/lib/types";
import { Tilt3D } from "./space/kit";
import { hashscanSchedule, hashscanTopic, hashscanTx, isInFlight, isSimTx, shortTx, usdc } from "../dashboard/format";

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
  return (
    <>
      <LedgerRow
        k="Hedera tx"
        v={
          isSimTx(s.hederaTxId) ? (
            <span className="mono text-xs text-muted" title={s.hederaTxId}>simulated</span>
          ) : (
            <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={hashscanTx(s.hederaTxId)} target="_blank" rel="noreferrer">
              {shortTx(s.hederaTxId)} ↗
            </a>
          )
        }
      />
      {s.refund && (
        <LedgerRow
          k="Scheduled refund"
          v={
            <a className="mono text-xs text-warn underline-offset-2 hover:underline" href={hashscanSchedule(s.refund.scheduleId)} target="_blank" rel="noreferrer">
              {s.refund.scheduleId} · {usdc(s.refund.amountAtomic)} USDC ↗
            </a>
          }
        />
      )}
      <LedgerRow
        k="HCS receipt"
        v={
          s.hcsSequence !== null && s.hcsTopicId ? (
            <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={hashscanTopic(s.hcsTopicId)} target="_blank" rel="noreferrer">
              {s.hcsTopicId} #{s.hcsSequence} ↗
            </a>
          ) : (
            <span className="mono text-xs text-muted">{s.hcsSequence !== null ? `#${s.hcsSequence}` : "not set"}</span>
          )
        }
      />
    </>
  );
}
