"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EnsView, Invoice, Quote, ReceiptChain, Settlement, Stats } from "@/lib/types";
import { Card, CardHead, LedgerRow, MockTag, Spinner, StatusPill } from "../components/ui";
import { ThemeToggle } from "../components/theme-toggle";
import { clock, hashscanSchedule, hashscanTopic, hashscanTx, isInFlight, isSimTx, rupees, shortHash, shortId, shortTx, timeAgo, usdc } from "./format";

/* ───────────────────────── data ───────────────────────── */

function useDashboardData() {
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [ens, setEns] = useState<EnsView | { error: string } | null>(null);
  const [invoice, setInvoice] = useState<{ decoded: Invoice; raw: string } | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [error, setError] = useState(false);

  const tick = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([
        fetch("/api/settlements", { cache: "no-store" }).then((r) => r.json() as Promise<Settlement[]>),
        fetch("/api/stats", { cache: "no-store" }).then((r) => r.json() as Promise<Stats>),
      ]);
      setSettlements(s);
      setStats(st);
      setLastOk(Date.now());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  const loadInvoice = useCallback(async () => {
    try {
      const res = await fetch("/merchant/book?from=CSMT&to=PUNE", { cache: "no-store" });
      const raw = res.headers.get("PAYMENT-REQUIRED");
      if (res.status === 402 && raw) setInvoice({ raw, decoded: JSON.parse(atob(raw)) as Invoice });
    } catch {
      /* the invoice card shows its own empty state */
    }
  }, []);

  useEffect(() => {
    tick();
    loadInvoice();
    fetch("/merchant/quote").then((r) => r.json()).then(setQuote).catch(() => undefined);
    fetch("/api/ens", { cache: "no-store" })
      .then((r) => r.json())
      .then(setEns)
      .catch(() => setEns({ error: "Could not reach /api/ens" }));
    const a = setInterval(tick, 1000);
    const b = setInterval(loadInvoice, 30_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [tick, loadInvoice]);

  return { settlements, stats, quote, ens, invoice, lastOk, error, refresh: tick };
}

/** Re-render every second so "x seconds ago" labels stay fresh. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/* ───────────────────────── small pieces ───────────────────────── */

/* ───────────────────────── header + banner ───────────────────────── */

function Header({ lastOk, error, now }: { lastOk: number | null; error: boolean; now: number }) {
  const fresh = lastOk !== null && now - lastOk < 4000 && !error;
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <a href="/" className="text-lg font-bold tracking-tight text-accent">sangam</a>
          <span className="text-line">/</span>
          <span className="text-sm font-medium">Settlement desk</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 text-xs text-muted sm:flex" aria-live="polite">
            <span className="relative flex h-2 w-2">
              {fresh && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${error ? "bg-bad" : fresh ? "bg-ok" : "bg-muted"}`} />
            </span>
            {error ? "API unreachable" : fresh ? "Live" : "Connecting…"}
          </span>
          <ThemeToggle />
          <a href="/verify" className="hidden rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink sm:block">
            Identity desk
          </a>
          <a href="/" className="hidden rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink sm:block">
            ← Home
          </a>
        </div>
      </div>
    </header>
  );
}

const MOCK_LABELS: Record<keyof Stats["mocks"], string> = {
  chainVerify: "chain check skipped",
  og: "0G mocked",
  psp: "UPI mocked",
  ens: "ENS offline",
  hcs: "HCS not set",
};

function SimBanner({ stats }: { stats: Stats | null }) {
  if (!stats || stats.mode === "live") return null;
  const mocked = (Object.keys(MOCK_LABELS) as (keyof Stats["mocks"])[]).filter((k) => stats.mocks[k]);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-warn/30 bg-warnbg/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warn text-xs font-bold text-surface">!</span>
        <p className="text-sm">
          <span className="font-semibold">{stats.mode === "simulation" ? "Simulation mode." : "Partly live."}</span>{" "}
          <span className="text-muted">
            {stats.mode === "simulation"
              ? "Every service is mocked. Turn them on one at a time in .env."
              : "Some services are still mocked. Simulated payments never move money, whatever the settings."}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:shrink-0 sm:justify-end">
        {mocked.map((k) => (
          <MockTag key={k}>{MOCK_LABELS[k]}</MockTag>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── KPI row ───────────────────────── */

function Kpis({ stats, settlements }: { stats: Stats | null; settlements: Settlement[] | null }) {
  const inFlight = settlements?.filter(isInFlight).length ?? 0;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Hero figure: the one number the desk exists to produce */}
      <Card className="relative overflow-hidden p-6 sm:col-span-2">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-ok/10 blur-3xl" />
        <p className="text-sm text-muted">Paid out to merchants</p>
        <p className="mt-2 text-5xl font-bold tracking-tight sm:text-6xl">
          {stats ? rupees(stats.inrPaidOutPaise) : <span className="text-muted">₹—</span>}
        </p>
        <p className="mt-3 text-sm text-muted">
          {stats ? (
            <>
              Across <span className="font-medium text-ink">{stats.paidCount}</span> UPI payout{stats.paidCount === 1 ? "" : "s"} to tickets@razorpay ·{" "}
              <span className="font-medium text-ink">50 bps</span> fee
            </>
          ) : (
            "Loading…"
          )}
        </p>
      </Card>
      <Card className="p-6">
        <p className="text-sm text-muted">Payments</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight">{stats?.count ?? "—"}</p>
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted">
          {inFlight > 0 ? (
            <>
              <Spinner className="text-info" /> {inFlight} in flight
            </>
          ) : (
            "None in flight"
          )}
        </p>
      </Card>
      <Card className="p-6">
        <p className="text-sm text-muted">USDC received</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight">{stats ? usdc(stats.usdcInAtomic, 2) : "—"}</p>
        <p className="mt-3 text-sm text-muted">
          {stats && stats.heldCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-warn">
              <span aria-hidden className="font-bold">‖</span> {stats.heldCount} held for review
            </span>
          ) : (
            "Nothing held for review"
          )}
        </p>
      </Card>
    </div>
  );
}

/* ───────────────────────── pipeline ───────────────────────── */

type StepState = "done" | "active" | "warn" | "fail" | "todo" | "skipped";

const STAGES = [
  { title: "Received", who: "merchant-api notice", tag: null },
  { title: "Verified", who: "Hedera Mirror Node", tag: "skipped · sim" },
  { title: "Decided", who: "0G Compute", tag: "mock" },
  { title: "Paid out", who: "UPI · RazorpayX", tag: "mock" },
  { title: "Receipt", who: "Hedera Consensus Service", tag: "not set" },
] as const;

function stageStates(s: Settlement): StepState[] {
  switch (s.status) {
    case "received":
      return ["done", "active", "todo", "todo", "todo"];
    case "confirmed":
      return ["done", "done", "active", "todo", "todo"];
    case "decided":
      return ["done", "done", "done", "active", "todo"];
    case "paid":
      return ["done", "done", "done", "done", s.hcsSequence !== null ? "done" : "skipped"];
    case "held":
      return ["done", "done", "done", "warn", "skipped"];
    case "failed": {
      const st: StepState[] = ["done", "done", "done", "done", "todo"];
      const at = s.decision ? 3 : s.fxRate ? 2 : 1;
      for (let i = at; i < 5; i++) st[i] = i === at ? "fail" : "todo";
      return st;
    }
  }
}

function Node({ state, n }: { state: StepState; n: number }) {
  const base = "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors duration-300";
  switch (state) {
    case "done":
      return <span className={`${base} bg-ok text-white dark:text-[#1a1917]`}>✓</span>;
    case "active":
      return (
        <span className={`${base} bg-accent text-white dark:text-[#1a1917]`}>
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/40" />
          <Spinner className="relative h-4 w-4" />
        </span>
      );
    case "warn":
      return <span className={`${base} bg-warn text-white dark:text-[#1a1917]`}>‖</span>;
    case "fail":
      return <span className={`${base} bg-bad text-white dark:text-[#1a1917]`}>✕</span>;
    case "skipped":
      return <span className={`${base} border-2 border-dashed border-line text-muted`}>–</span>;
    default:
      return <span className={`${base} border-2 border-line bg-surface text-muted`}>{n}</span>;
  }
}

/** The line between two nodes: solid when passed, flowing dots when work is happening, faint dots otherwise. */
function Connector({ from, to, vertical = false }: { from: StepState; to: StepState; vertical?: boolean }) {
  const passed = from === "done" && (to === "done" || to === "warn" || to === "fail" || to === "skipped");
  const flowing = from === "done" && to === "active";
  const size = vertical ? "w-[3px] h-full" : "h-[3px] w-full";
  if (passed) return <span className={`${size} rounded-full bg-ok/70`} />;
  if (flowing) return <span className={`dot-link ${size} ${vertical ? "dot-link-v" : ""}`} />;
  return <span className={`${size} rounded-full bg-line`} />;
}

function Pipeline({ s }: { s: Settlement }) {
  const states = stageStates(s);
  return (
    <>
      {/* desktop: horizontal */}
      <ol className="hidden grid-cols-5 md:grid">
        {STAGES.map((st, i) => (
          <li key={st.title} className="relative flex flex-col items-center text-center">
            {i > 0 && (
              <span className="absolute right-1/2 top-5 flex w-full -translate-y-1/2 items-center px-6">
                <Connector from={states[i - 1]!} to={states[i]!} />
              </span>
            )}
            <span className="relative z-10">
              <Node state={states[i]!} n={i + 1} />
            </span>
            <p className="mt-3 text-sm font-semibold">{st.title}</p>
            <p className="mt-0.5 text-[11px] text-muted">{st.who}</p>
            {st.tag && (st.tag !== "not set" || states[i] === "skipped") && <span className="mt-2"><MockTag>{st.tag}</MockTag></span>}
          </li>
        ))}
      </ol>
      {/* mobile: vertical */}
      <ol className="space-y-0 md:hidden">
        {STAGES.map((st, i) => (
          <li key={st.title} className="flex gap-4">
            <div className="flex flex-col items-center">
              <Node state={states[i]!} n={i + 1} />
              {i < STAGES.length - 1 && (
                <span className="flex h-8 justify-center py-1">
                  <Connector from={states[i]!} to={states[i + 1]!} vertical />
                </span>
              )}
            </div>
            <div className="pt-2">
              <p className="text-sm font-semibold">{st.title}</p>
              <p className="text-[11px] text-muted">{st.who}</p>
            </div>
            {st.tag && (st.tag !== "not set" || states[i] === "skipped") && (
              <span className="ml-auto pt-2"><MockTag>{st.tag}</MockTag></span>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function PaymentDetail({ s, pinned, onFollow, now }: { s: Settlement; pinned: boolean; onFollow: () => void; now: number }) {
  const fee = s.payoutPaise !== null ? s.inrGrossPaise - s.payoutPaise : null;
  return (
    <Card className="overflow-hidden">
      <CardHead
        title={`Payment ${shortId(s.id)}`}
        hint={`${clock(s.createdAt)} · ${timeAgo(s.createdAt, now)}`}
        right={
          <div className="flex items-center gap-2">
            {pinned ? (
              <button onClick={onFollow} className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-ink">
                Follow latest
              </button>
            ) : (
              <span className="hidden text-xs text-muted sm:inline">Following latest</span>
            )}
            <StatusPill s={s} />
          </div>
        }
      />
      <div className="px-5 py-7">
        <p className="sr-only" aria-live="polite">
          Payment {shortId(s.id)} is {isInFlight(s) ? "processing" : s.status}.
        </p>
        <Pipeline s={s} />
      </div>

      <div className="grid grid-cols-1 gap-px border-t border-line bg-line md:grid-cols-3">
        {/* money */}
        <div className="bg-surface px-5 py-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Money</p>
          <LedgerRow k="Received" v={`${usdc(s.usdcAmount)} USDC`} />
          <LedgerRow k="FX" v={s.fxRate ? `₹${s.fxRate.toFixed(2)} / USDC` : "—"} tone="text-muted" />
          <LedgerRow k="Gross" v={s.inrGrossPaise ? rupees(s.inrGrossPaise) : "—"} />
          <LedgerRow k={`Fee${s.feeBps ? ` (${s.feeBps} bps)` : ""}`} v={fee !== null ? `−${rupees(fee)}` : "—"} tone="text-muted" />
          <div className="mt-1 border-t border-line">
            <LedgerRow
              k={s.status === "held" ? "Held, not paid" : "To merchant"}
              v={s.payoutPaise !== null ? rupees(s.payoutPaise) : "—"}
              tone={s.status === "paid" ? "text-ok" : s.status === "held" ? "text-warn" : ""}
              strong
            />
          </div>
        </div>
        {/* decision */}
        <div className="bg-surface px-5 py-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Decision</p>
          {s.decision ? (
            <>
              <p className="text-lg font-semibold">{s.decision === "payout" ? "Pay out" : "Hold"}</p>
              <p className="mt-2 rounded-lg bg-surface2 p-3 text-sm italic text-muted">“{s.decisionReason?.replace(/^\[mock\]\s*/, "")}”</p>
              <p className="mono mt-2 truncate text-[10.5px] text-muted" title={s.ogChatId ?? ""}>
                {s.ogChatId?.startsWith("mock-") ? "mock decision · " : s.ogVerified ? "0G chat, verified · " : "0G chat · "}
                {s.ogChatId}
              </p>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              {isInFlight(s) ? <><Spinner /> Waiting for the decision…</> : "No decision."}
            </p>
          )}
          {s.error && <p className="mt-3 rounded-lg bg-badbg p-3 text-sm text-bad">{s.error}</p>}
        </div>
        {/* proof */}
        <div className="bg-surface px-5 py-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Proof</p>
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
          <LedgerRow
            k="On-chain check"
            v={<span className="text-xs text-muted">{isSimTx(s.hederaTxId) ? "simulated" : s.chainVerified ? "Mirror Node ✓" : s.status === "received" ? "—" : "skipped"}</span>}
          />
          <LedgerRow k="Payer" v={<span className="mono text-xs">{s.payer ?? "—"}</span>} />
          {s.refund && (
            <LedgerRow
              k="Scheduled refund"
              v={
                <a
                  className="mono text-xs text-warn underline-offset-2 hover:underline"
                  href={hashscanSchedule(s.refund.scheduleId)}
                  target="_blank"
                  rel="noreferrer"
                  title="USDC back to the payer once the treasury's signature lands"
                >
                  {s.refund.scheduleId} · {usdc(s.refund.amountAtomic)} USDC ↗
                </a>
              }
            />
          )}
          <LedgerRow k="UPI payout ref" v={<span className="mono text-xs" title={s.payoutRef ?? ""}>{s.payoutRef ?? "—"}</span>} />
          {s.ondc && (
            <>
              <LedgerRow k="ONDC order" v={<span className="mono text-xs" title={s.ondc.transactionId}>{s.ondc.orderId} · {s.ondc.state}</span>} />
              <LedgerRow k="ONDC seller" v={<span className="text-xs" title={s.ondc.bppId}>{s.ondc.providerName}</span>} />
              <LedgerRow
                k="Items"
                v={<span className="text-xs">{s.ondc.items.map((i) => i.name).join(", ")} · {rupees(s.ondc.quoteInrPaise)}</span>}
              />
            </>
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
        </div>
      </div>
    </Card>
  );
}

/* ───────────────────────── side cards ───────────────────────── */

function TryCard({ stats, onSent }: { stats: Stats | null; onSent: () => void }) {
  const [busy, setBusy] = useState<"ok" | "short" | "agent" | "ondc" | null>(null);
  const [agentMsg, setAgentMsg] = useState<{ ok: boolean; text: string; href?: string } | null>(null);
  const canSim = stats?.actions.simulate ?? false;
  const canPay = stats?.actions.payAsAgent ?? false;

  async function send(short: boolean) {
    setBusy(short ? "short" : "ok");
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ short }),
      });
      if (res.ok) onSent();
    } finally {
      setBusy(null);
    }
  }

  async function payAsAgent(kind: "ticket" | "ondc") {
    setBusy(kind === "ondc" ? "ondc" : "agent");
    setAgentMsg(null);
    try {
      const res = await fetch("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "ondc" ? { kind, q: "atta", qty: 1 } : { kind }),
      });
      const body = (await res.json()) as {
        error?: string;
        hederaTxId?: string;
        hashscan?: string;
        bought?: string;
        ticket?: { pnr: string };
        result?: { ondc?: { orderId: string; state: string } };
      };
      if (!res.ok || !body.hederaTxId) {
        setAgentMsg({ ok: false, text: body.error ?? `Failed (${res.status})` });
        return;
      }
      const detail =
        kind === "ondc"
          ? `${body.bought} · ONDC order ${body.result?.ondc?.orderId ?? "—"} (${body.result?.ondc?.state ?? "?"})`
          : `PNR ${body.ticket?.pnr ?? "—"}`;
      setAgentMsg({ ok: true, text: `Paid ${shortTx(body.hederaTxId)} · ${detail}`, href: body.hashscan });
      onSent();
    } catch (err) {
      setAgentMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHead title="Send a payment" hint="An agent pays tickets.sangam.eth. Watch it settle." />
      <div className="space-y-2.5 p-5">
        {stats?.budget && (
          <div className="rounded-xl border border-line bg-surface2 px-4 py-3" title="CUSTOMER_TOTAL_BUDGET: the agent's cumulative USDC cap">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted">Agent budget left</span>
              <span className="tabular-nums font-medium">
                {usdc(stats.budget.remainingAtomic, 2)} <span className="text-muted">of {usdc(stats.budget.limitAtomic, 2)} USDC</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{
                  width: `${Math.min(100, (Number(stats.budget.remainingAtomic) / Math.max(1, Number(stats.budget.limitAtomic))) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
        <button
          onClick={() => payAsAgent("ticket")}
          disabled={busy !== null || !canPay}
          title={canPay ? undefined : "Set CUSTOMER_ACCOUNT_ID and CUSTOMER_PRIVATE_KEY in .env"}
          className="flex w-full items-center justify-between rounded-xl bg-accent px-4 py-3 text-left font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#1a1917]"
        >
          <span>
            Pay as agent
            <span className="block text-xs font-normal opacity-80">
              {canPay ? "Real testnet USDC over x402, no approval step" : "Needs a funded customer account in .env"}
            </span>
          </span>
          {busy === "agent" ? <Spinner className="h-4 w-4" /> : <span aria-hidden>→</span>}
        </button>
        <button
          onClick={() => payAsAgent("ondc")}
          disabled={busy !== null || !canPay}
          title={canPay ? undefined : "Set CUSTOMER_ACCOUNT_ID and CUSTOMER_PRIVATE_KEY in .env"}
          className="flex w-full items-center justify-between rounded-xl border border-accent/50 bg-surface px-4 py-3 text-left font-medium transition-colors hover:border-accent disabled:opacity-60"
        >
          <span>
            Buy on ONDC as agent
            <span className="block text-xs font-normal text-muted">10 kg atta from an ONDC seller, ~₹460 in USDC</span>
          </span>
          {busy === "ondc" ? <Spinner className="h-4 w-4" /> : <span aria-hidden className="text-muted">→</span>}
        </button>
        {agentMsg && (
          <p className={`rounded-lg p-3 text-xs ${agentMsg.ok ? "bg-surface2 text-muted" : "bg-badbg text-bad"}`} role="status">
            {agentMsg.text}
            {agentMsg.href && (
              <>
                {" · "}
                <a className="text-accent underline-offset-2 hover:underline" href={agentMsg.href} target="_blank" rel="noreferrer">
                  HashScan ↗
                </a>
              </>
            )}
          </p>
        )}
        {canSim && (
          <>
            <p className="pt-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Simulated, no money moves</p>
            <button
              onClick={() => send(false)}
              disabled={busy !== null}
              className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-left font-medium transition-colors hover:border-accent disabled:opacity-60"
            >
              <span>
                Simulate a payment
                <span className="block text-xs font-normal text-muted">Full price, gets paid out</span>
              </span>
              {busy === "ok" ? <Spinner className="h-4 w-4" /> : <span aria-hidden className="text-muted">→</span>}
            </button>
            <button
              onClick={() => send(true)}
              disabled={busy !== null}
              className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-left font-medium transition-colors hover:border-warn disabled:opacity-60"
            >
              <span>
                Simulate an underpayment
                <span className="block text-xs font-normal text-muted">10% short, gets held</span>
              </span>
              {busy === "short" ? <Spinner className="h-4 w-4" /> : <span aria-hidden className="text-muted">→</span>}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

function InvoiceCard({ invoice }: { invoice: { decoded: Invoice; raw: string } | null }) {
  const [raw, setRaw] = useState(false);
  const a = invoice?.decoded.accepts[0];
  return (
    <Card>
      <CardHead
        title="Live 402 invoice"
        hint="What an unpaid agent gets back"
        right={<span className="mono rounded-md bg-warnbg px-2 py-0.5 text-[11px] font-semibold text-warn">402</span>}
      />
      <div className="px-5 py-3">
        <p className="mono mb-2 truncate text-[11px] text-muted">GET /api/book?from=CSMT&amp;to=PUNE</p>
        {a ? (
          <>
            <LedgerRow k="Amount" v={<><span className="font-semibold">{usdc(a.amount, 6)}</span> <span className="text-muted">USDC</span></>} />
            <LedgerRow k="Pay to" v={<span className="mono text-xs">{a.payTo}</span>} />
            <LedgerRow k="Token" v={<span className="mono text-xs">{a.asset}</span>} />
            <LedgerRow k="Network" v={<span className="mono text-xs">{a.network}</span>} />
            <LedgerRow k="Expires in" v={`${a.maxTimeoutSeconds}s`} />
            <button onClick={() => setRaw((r) => !r)} className="mt-2 text-xs text-accent underline-offset-2 hover:underline">
              {raw ? "Hide" : "Show"} raw PAYMENT-REQUIRED header
            </button>
            {raw && (
              <pre className="mono mt-2 max-h-32 overflow-auto break-all whitespace-pre-wrap rounded-lg bg-[#1a1917] p-3 text-[10.5px] text-[#ece9e2]">
                {invoice!.raw}
              </pre>
            )}
          </>
        ) : (
          <p className="py-4 text-sm text-muted">Fetching invoice…</p>
        )}
      </div>
    </Card>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="text-accent underline-offset-2 hover:underline" href={href} target="_blank" rel="noreferrer">
      {children} ↗
    </a>
  );
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function MerchantCard({
  quote,
  ens,
  verified,
}: {
  quote: Quote | null;
  ens: EnsView | { error: string } | null;
  verified: boolean;
}) {
  const view = ens && !("error" in ens) ? ens : null;
  return (
    <Card>
      <CardHead
        title="Merchant on ENS"
        hint={view?.source === "ens" ? "Read live from ENSv2 on Sepolia" : "Found by ENS name"}
        right={
          view ? (
            <div className="flex items-center gap-1.5">
              {verified && (
                <span className="rounded-full bg-okbg px-2 py-0.5 text-[11px] font-medium text-ok" title="Verified with the Self offchain SDK via Aadhaar">
                  Aadhaar ✓
                </span>
              )}
              {view.source === "ens" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2 py-0.5 text-[11px] font-medium text-ok">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" /> live
                </span>
              ) : (
                <MockTag>ENS offline</MockTag>
              )}
            </div>
          ) : null
        }
      />
      <div className="px-5 py-3">
        {view ? (
          <>
            <p className="mono mb-1 break-all text-sm font-semibold text-accent">
              <ExtLink href={view.links.app}>{view.name}</ExtLink>
            </p>
            <p className="mb-2 text-xs text-muted">
              Issued by Sangam under <span className="mono">{view.parent}</span>. The merchant needs no wallet.
            </p>
            {quote && <LedgerRow k="Price" v={<>₹{quote.priceInr} <span className="text-muted">· {Number(quote.priceUsdc).toFixed(4)} USDC</span></>} />}

            <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Text records</p>
            <div className="rounded-lg bg-surface2 px-3 py-1">
              {view.records.map((r) => (
                <div key={r.key} className="flex items-baseline justify-between gap-3 py-1">
                  <span className="mono shrink-0 text-[11px] text-muted">{r.key}</span>
                  <span className="mono min-w-0 truncate text-right text-[11px]" title={r.value}>{r.value}</span>
                </div>
              ))}
            </div>

            {(view.registry || view.resolver) && (
              <>
                <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">ENSv2 contracts</p>
                {view.registry && view.links.registry && (
                  <LedgerRow k="Subname registry" v={<span className="mono text-xs"><ExtLink href={view.links.registry}>{short(view.registry)}</ExtLink></span>} />
                )}
                {view.resolver && view.links.resolver && (
                  <LedgerRow k="Resolver" v={<span className="mono text-xs"><ExtLink href={view.links.resolver}>{short(view.resolver)}</ExtLink></span>} />
                )}
              </>
            )}

            {quote && (
              <div className="flex flex-wrap gap-1.5 pb-1 pt-3">
                {quote.routes.map((r) => (
                  <span key={r} className="mono rounded-md border border-line px-2 py-0.5 text-[11px] text-muted">{r.replace("-", " → ")}</span>
                ))}
              </div>
            )}
          </>
        ) : ens && "error" in ens ? (
          <p className="my-3 rounded-lg bg-badbg p-3 text-sm text-bad">{ens.error}</p>
        ) : (
          <p className="py-4 text-sm text-muted">Loading…</p>
        )}
      </div>
    </Card>
  );
}

/* ───────────────────────── receipt chain ───────────────────────── */

function ReceiptChainCard() {
  const [chain, setChain] = useState<ReceiptChain | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/receipts", { cache: "no-store" })
        .then((r) => r.json() as Promise<ReceiptChain>)
        .then(setChain)
        .catch(() => undefined);
    load();
    const t = setInterval(load, 10_000); // the mirror node lags a few seconds; no point polling faster
    return () => clearInterval(t);
  }, []);

  if (!chain?.enabled) return null;
  const pill = chain.error ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-badbg px-2.5 py-0.5 text-xs font-medium text-bad">✕ {chain.error}</span>
  ) : chain.lagging ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-infobg px-2.5 py-0.5 text-xs font-medium text-info">
      <Spinner /> Latest receipts propagating
    </span>
  ) : chain.intact ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2.5 py-0.5 text-xs font-medium text-ok">✓ Chain intact</span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-badbg px-2.5 py-0.5 text-xs font-medium text-bad">✗ Broken at #{chain.brokenAtSeq}</span>
  );

  return (
    <Card>
      <CardHead title="Receipt chain" hint="Every HCS receipt links to the one before it — replayed from the Mirror Node, not our files." right={pill} />
      <div className="px-5 py-3">
        {chain.head ? (
          <>
            <LedgerRow
              k="Topic"
              v={
                <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={hashscanTopic(chain.topicId)} target="_blank" rel="noreferrer">
                  {chain.topicId} ↗
                </a>
              }
            />
            <LedgerRow k="Receipts" v={<span className="tabular-nums">#{chain.head.seq} of {chain.length}</span>} />
            <LedgerRow k="Head hash" v={<span className="mono text-[10.5px]" title={chain.head.hash}>{shortHash(chain.head.hash)}</span>} />
          </>
        ) : (
          <p className="py-3 text-sm text-muted">No receipts on the topic yet.</p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Each receipt carries the previous receipt's sha256, so dropping or reordering one breaks the chain — for
          everyone, not just for us.
        </p>
      </div>
    </Card>
  );
}

/* ───────────────────────── table ───────────────────────── */

function PaymentsTable({ rows, selectedId, onSelect, now }: { rows: Settlement[]; selectedId: string | null; onSelect: (id: string) => void; now: number }) {
  return (
    <Card>
      <CardHead title="All payments" hint="Newest first. Click a row to inspect it." right={<span className="text-xs text-muted">{rows.length} total</span>} />
      {rows.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <p className="font-medium">No payments yet</p>
          <p className="mt-1 text-sm text-muted">Send a test payment and it will show up here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="whitespace-nowrap border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                <th className="px-5 py-3 font-semibold">When</th>
                <th className="px-3 py-3 text-right font-semibold">USDC in</th>
                <th className="px-3 py-3 text-right font-semibold">₹ to merchant</th>
                <th className="px-3 py-3 font-semibold">Decision</th>
                <th className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const sel = s.id === selectedId;
                return (
                  <tr
                    key={s.id}
                    tabIndex={0}
                    aria-selected={sel}
                    aria-label={`Payment at ${clock(s.createdAt)}, ${s.status}. Press Enter to inspect.`}
                    onClick={() => onSelect(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(s.id);
                      }
                    }}
                    className={`cursor-pointer border-b border-line transition-colors last:border-0 ${sel ? "bg-accentbg/60" : "hover:bg-surface2"}`}
                  >
                    <td className={`whitespace-nowrap px-5 py-3 ${sel ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`}>
                      <span className="tabular-nums">{clock(s.createdAt)}</span>
                      <span className="ml-2 text-xs text-muted">{timeAgo(s.createdAt, now)}</span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{usdc(s.usdcAmount)}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${s.status === "paid" ? "font-medium" : "text-muted"}`}>
                      {s.status === "paid" && s.payoutPaise !== null ? rupees(s.payoutPaise) : s.status === "held" ? "held" : "—"}
                    </td>
                    <td className="max-w-[220px] px-3 py-3">
                      {s.decision ? (
                        <span className="block truncate text-muted" title={s.decisionReason ?? ""}>
                          <span className="font-medium text-ink">{s.decision === "payout" ? "Pay out" : "Hold"}</span>
                          {" · "}
                          {s.decisionReason?.replace(/^\[mock\]\s*/, "")}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3"><StatusPill s={s} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ───────────────────────── page ───────────────────────── */

export function Dashboard() {
  const { settlements, stats, quote, ens, invoice, lastOk, error, refresh } = useDashboardData();
  const now = useNow();
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [merchantVerified, setMerchantVerified] = useState(false);

  // Whether the ENS merchant has an Aadhaar-verified identity (refreshed on settle).
  useEffect(() => {
    const load = () =>
      fetch("/api/self/identities", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ role: string; label: string }[]>)
        .then((rows) => {
          const name = typeof ens === "object" && ens && !("error" in ens) ? ens.name : null;
          setMerchantVerified(!!name && rows.some((i) => i.role === "merchant" && i.label.toLowerCase() === name.toLowerCase()));
        })
        .catch(() => undefined);
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [ens]);

  const rows = useMemo(() => settlements ?? [], [settlements]);
  const pinned = pinnedId ? rows.find((s) => s.id === pinnedId) : undefined;
  const selected = pinned ?? rows[0];

  return (
    <div className="min-h-screen">
      <Header lastOk={lastOk} error={error} now={now} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl space-y-5 px-5 py-6 outline-none sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Settlement desk</h1>
            <p className="mt-1 text-sm text-muted">Every agent payment, from USDC in to rupees out.</p>
          </div>
        </div>

        <SimBanner stats={stats} />
        <Kpis stats={stats} settlements={settlements} />

        {/* Phone order: detail → test buttons → table. Wide screens (xl): detail +
            table on the left, the side cards spanning both rows on the right. */}
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
          <div className="min-w-0 xl:col-start-1 xl:row-start-1">
            {selected ? (
              <PaymentDetail s={selected} pinned={!!pinned} onFollow={() => setPinnedId(null)} now={now} />
            ) : (
              <Card className="flex min-h-[340px] flex-col items-center justify-center p-10 text-center">
                <p className="font-medium">{settlements ? "No payments yet" : "Loading…"}</p>
                <p className="mt-1 max-w-xs text-sm text-muted">Send a test payment to watch it move through the pipeline.</p>
              </Card>
            )}
          </div>
          <div className="min-w-0 xl:col-start-1 xl:row-start-2">
            <PaymentsTable rows={rows} selectedId={selected?.id ?? null} onSelect={setPinnedId} now={now} />
          </div>
          <div className="row-start-2 grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:grid-cols-1">
            <TryCard
              stats={stats}
              onSent={() => {
                setPinnedId(null); // follow the newest payment, which is this one
                refresh();
              }}
            />
            <ReceiptChainCard />
            <InvoiceCard invoice={invoice} />
            <MerchantCard quote={quote} ens={ens} verified={merchantVerified} />
          </div>
        </div>
      </main>
    </div>
  );
}
