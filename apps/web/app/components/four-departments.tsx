"use client";

import { useEffect, useState } from "react";

/* Each department, with literal Tailwind classes per tone (v4 needs them spelled out).
   "panel*" classes are for the always-dark record panel, so they use the dark palette. */
const DEPTS = [
  {
    n: 1,
    role: "Acquiring bank",
    usually: "a bank partnership and a card network",
    sangam: "Hedera Mirror Node",
    does: "Confirms the USDC really moved, on-chain, before anything is paid out.",
    dot: "bg-info",
    text: "text-info",
    tint: "bg-infobg",
    ring: "border-info shadow-[0_8px_30px_-8px_var(--color-info)]",
    panelBar: "border-[#3987e5]",
    panelTint: "bg-[#3987e5]/10",
    panelDot: "bg-[#3987e5]",
  },
  {
    n: 2,
    role: "Risk desk",
    usually: "an analyst team and a rules engine",
    sangam: "0G Compute",
    does: "A model decides payout or hold, and writes down why.",
    dot: "bg-accent",
    text: "text-accent",
    tint: "bg-accentbg",
    ring: "border-accent shadow-[0_8px_30px_-8px_var(--color-accent)]",
    panelBar: "border-[#977dff]",
    panelTint: "bg-[#977dff]/10",
    panelDot: "bg-[#977dff]",
  },
  {
    n: 3,
    role: "FX & remittance desk",
    usually: "a forex licence and a remittance partner",
    sangam: "Live FX + RazorpayX UPI",
    does: "Converts at the live rate, takes 50 bps, sends rupees over UPI.",
    dot: "bg-ok",
    text: "text-ok",
    tint: "bg-okbg",
    ring: "border-ok shadow-[0_8px_30px_-8px_var(--color-ok)]",
    panelBar: "border-[#35c135]",
    panelTint: "bg-[#35c135]/10",
    panelDot: "bg-[#35c135]",
  },
  {
    n: 4,
    role: "Bookkeeper",
    usually: "an accounting team and month-end close",
    sangam: "Hedera Consensus Service",
    does: "Writes the settlement to a topic nobody can quietly edit.",
    dot: "bg-warn",
    text: "text-warn",
    tint: "bg-warnbg",
    ring: "border-warn shadow-[0_8px_30px_-8px_var(--color-warn)]",
    panelBar: "border-[#f0c062]",
    panelTint: "bg-[#f0c062]/10",
    panelDot: "bg-[#f0c062]",
  },
] as const;

type Line = { k: string; v: string; s?: boolean; note?: string };

/* The real settlement record from the sim run, grouped by which department wrote it.
   stage: 0 = created, 1–4 = written by department n, 5 = final status. */
const RECORD: { stage: number; lines: Line[] }[] = [
  { stage: 0, lines: [{ k: "id", v: "fdcea8b1-7f0c-…", s: true }] },
  {
    stage: 1,
    lines: [
      { k: "hederaTxId", v: "sim-0.0.1001@1793444010523.0", s: true },
      { k: "payer", v: "0.0.1001", s: true },
      { k: "usdcAmount", v: "515391", s: true },
    ],
  },
  {
    stage: 2,
    lines: [
      { k: "decision", v: "payout", s: true },
      { k: "decisionReason", v: "Amount matches the quote…", s: true },
    ],
  },
  {
    stage: 3,
    lines: [
      { k: "fxRate", v: "95.073571" },
      { k: "feeBps", v: "50" },
      { k: "payoutPaise", v: "4875" },
      { k: "payoutRef", v: "mockpout_2532ede9-088", s: true },
    ],
  },
  { stage: 4, lines: [{ k: "hcsSequence", v: "null", note: "topic not set in sim" }] },
  { stage: 5, lines: [{ k: "status", v: "paid", s: true }] },
];

/* How long each stage stays on screen before the next one (ms). */
const STAGE_MS = [700, 1800, 1800, 1800, 1800, 3000];

/** Cycles 0 → 5 and loops. Holds on everything when the user prefers reduced motion. */
function useStage() {
  const [stage, setStage] = useState(5);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    if (mq.matches) return;
    let s = 0;
    setStage(0);
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      t = setTimeout(() => {
        s = (s + 1) % STAGE_MS.length;
        setStage(s);
        tick();
      }, STAGE_MS[s]);
    };
    tick();
    return () => clearTimeout(t);
  }, []);

  return { stage, reduced };
}

function RecordPanel({ stage, focus }: { stage: number; focus: number | null }) {
  const writing = stage < 5 && focus === null;
  return (
    <div className="overflow-hidden rounded-2xl border border-[#2e2d3a] bg-[#0e0d13] shadow-xl">
      <div className="flex items-center justify-between border-b border-[#2e2d3a] px-5 py-3">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#e06456]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#f0c062]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#35c135]" />
          <span className="mono ml-2 text-[11px] text-[#a4a3af]">data/settlements.json</span>
        </span>
        {writing ? (
          <span className="flex items-center gap-1.5 rounded-full bg-[#3a2416] px-2.5 py-0.5 text-[11px] font-medium text-[#977dff]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#977dff]" />
            writing…
          </span>
        ) : (
          <span className="rounded-full bg-[#173226] px-2.5 py-0.5 text-[11px] font-medium text-[#35c135]">
            ✓ one record
          </span>
        )}
      </div>

      <div className="mono overflow-x-auto py-4 text-[12.5px] leading-[1.75] text-[#efeff4]">
        <div className="px-5 text-[#a4a3af]">{"{"}</div>
        {RECORD.map((group) => {
          const d = group.stage >= 1 && group.stage <= 4 ? DEPTS[group.stage - 1] : null;
          const shown = focus !== null || group.stage <= stage;
          const active = focus !== null ? focus === group.stage : group.stage === stage;
          const dim = focus !== null && !active;
          const isStatus = group.stage === 5;
          return (
            <div
              key={group.stage}
              className={[
                "relative border-l-2 py-0.5 pl-7 pr-5 transition-all duration-500",
                d ? d.panelBar : "border-transparent",
                active && d ? d.panelTint : "",
                !shown ? "opacity-0" : dim ? "opacity-30" : "opacity-100",
              ].join(" ")}
            >
              {d && (
                <span
                  className={`absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-[#0e0d13] ${d.panelDot} ${active ? "record-badge-pop" : ""}`}
                >
                  {d.n}
                </span>
              )}
              {group.lines.map((l, li) => (
                <div
                  key={l.k}
                  className={`whitespace-nowrap ${active && !focus ? "record-line-in" : ""}`}
                  style={active && !focus ? { animationDelay: `${li * 140}ms` } : undefined}
                >
                  <span className="text-[#3987e5]">&quot;{l.k}&quot;</span>
                  <span className="text-[#a4a3af]">: </span>
                  <span
                    className={
                      isStatus
                        ? `rounded px-1 font-semibold text-[#35c135] ${active ? "record-paid" : ""}`
                        : l.v === "null"
                          ? "text-[#a4a3af]"
                          : l.s
                            ? "text-[#f0c062]"
                            : "text-[#977dff]"
                    }
                  >
                    {l.s ? `"${l.v}"` : l.v}
                  </span>
                  <span className="text-[#a4a3af]">,</span>
                  {l.note && <span className="text-[#73727e]">{"  // "}{l.note}</span>}
                  {writing && active && li === group.lines.length - 1 && (
                    <span className="record-cursor ml-1 inline-block h-[1.05em] w-[7px] translate-y-[3px] bg-[#977dff]" />
                  )}
                </div>
              ))}
            </div>
          );
        })}
        <div className="px-5 text-[#a4a3af]">{"}"}</div>
      </div>
    </div>
  );
}

export function FourDepartments() {
  const { stage, reduced } = useStage();
  const [hover, setHover] = useState<number | null>(null);
  // Hovering a card pins that department. With reduced motion and no hover,
  // the full record shows with nothing highlighted.
  const focus = hover;
  const activeDept = hover ?? (reduced ? null : stage);

  return (
    <section id="what" className="mx-auto max-w-6xl px-5 py-20">
      {/* Header */}
      <div className="mx-auto mb-14 max-w-2xl text-center">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
          What Sangam is
        </p>
        <h2 className="display text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          Four departments, one record.
        </h2>
        <p className="mt-4 text-balance text-muted">
          A payment company needs four teams to move money across a border. In Sangam
          each one is a service, and all four write to the same settlement. Hover a
          department to see what it wrote.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        {/* Departments */}
        <ol className="space-y-4" onMouseLeave={() => setHover(null)}>
          {DEPTS.map((d) => {
            const on = activeDept === d.n;
            return (
              <li
                key={d.role}
                tabIndex={0}
                onMouseEnter={() => setHover(d.n)}
                onFocus={() => setHover(d.n)}
                onBlur={() => setHover(null)}
                className={[
                  "cursor-default rounded-2xl border-2 bg-surface p-6 transition-all duration-500 sm:p-7",
                  on ? `${d.ring} -translate-y-0.5` : "border-line",
                ].join(" ")}
              >
                <div className="flex items-start gap-5">
                  <span
                    className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white dark:text-[#0e0d13] ${d.dot}`}
                  >
                    {on && <span className={`step-ripple-fast absolute inset-0 rounded-full ${d.dot}`} />}
                    <span className="relative">{d.n}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">{d.role}</h3>
                      <span className={`mono rounded-lg px-2.5 py-1 text-xs font-medium ${d.tint} ${d.text}`}>
                        {d.sangam}
                      </span>
                    </div>
                    <p className="mt-2 text-base text-muted">{d.does}</p>
                    <p className="mt-3 text-sm text-muted">
                      <span className="line-through decoration-bad/50">Usually: {d.usually}</span>
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {/* The record they all write to */}
        <div className="lg:sticky lg:top-8">
          <RecordPanel stage={reduced && hover === null ? 5 : stage} focus={focus} />
          <p className="mt-3 text-center text-xs text-muted">
            The record from our sim run. Each coloured group is written by the matching
            department.
          </p>
        </div>
      </div>

      {/* Boundaries */}
      <div className="mt-14 rounded-3xl border border-line bg-surface2 p-6 text-center sm:p-8">
        <div className="mb-4 flex flex-wrap justify-center gap-2">
          {["Not a wallet", "Not an exchange", "Not a checkout page"].map((t) => (
            <span
              key={t}
              className="rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium"
            >
              <span className="text-bad">✕</span> {t}
            </span>
          ))}
        </div>
        <p className="mx-auto max-w-xl text-balance text-muted">
          Sangam never holds the agent&apos;s keys or the merchant&apos;s bank login. It
          reads the chain, makes the call, sends the rupees and writes the record.
        </p>
      </div>
    </section>
  );
}
