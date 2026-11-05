"use client";

import { useEffect, useState } from "react";
import type { Settlement, Stats } from "@/lib/types";
import { Card, CardHead, LedgerRow, MockTag, Spinner, StatusPill, idBadge } from "../components/ui";
import { ThemeToggle } from "../components/theme-toggle";
import { clock, hashscanTopic, hashscanTx, isSimTx, rupees, timeAgo, usdc } from "../dashboard/format";

/*
 * The buyer desk: what this buyer's agent has bought, and what's left to
 * spend. The agent's identity is its Hedera account (CUSTOMER_ACCOUNT_ID);
 * the human behind it registers once with Self — an Aadhaar proof in India,
 * a passport proof anywhere else — and this desk shows the badge once it's
 * done. Until then it points at /verify.
 */

const LOCALSTORAGE_KEY = "sangam.self.userId";

type Identity = {
  nullifier: string;
  role: "merchant" | "user";
  label: string;
  userId: string;
  attestationId: number;
  disclosed: Record<string, string>;
  verifiedAt: string;
};

export default function BuyerPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const [st, rows] = await Promise.all([
          fetch("/api/stats", { cache: "no-store" }).then((r) => r.json() as Promise<Stats>),
          fetch("/api/settlements", { cache: "no-store" }).then((r) => r.json() as Promise<Settlement[]>),
        ]);
        if (!alive) return;
        const payer = st.customerAccountId;
        setStats(st);
        setSettlements(payer ? rows.filter((s) => s.payer === payer) : []);
        setError(false);
      } catch {
        if (alive) setError(true);
      }
    }
    fetch("/api/self/identities", { cache: "no-store" })
      .then((r) => r.json() as Promise<Identity[]>)
      .then((rows) => {
        if (!alive) return;
        try {
          const userId = localStorage.getItem(LOCALSTORAGE_KEY);
          setIdentity((userId && rows.find((i) => i.role === "user" && i.userId === userId)) || null);
        } catch {
          setIdentity(null);
        }
      })
      .catch(() => setIdentity(null));
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const rows = settlements ?? [];
  const paid = rows.filter((s) => s.status === "paid");
  const held = rows.filter((s) => s.status === "held");
  const budget = stats?.budget ?? null;
  const badge = identity ? idBadge(identity.attestationId) : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <a href="/" className="text-lg font-bold tracking-tight text-accent">sangam</a>
            <span className="text-line">/</span>
            <span className="text-sm font-medium">Buyer desk</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <a href="/verify" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink">
              Identity desk
            </a>
            <a href="/dashboard" className="hidden rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink sm:block">
              Settlement desk →
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-5 py-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Your agent's purchases</h1>
            <p className="mt-1 text-sm text-muted">
              Paid with USDC on Hedera, no approval step.
              {stats?.customerAccountId && (
                <>
                  {" "}Agent account: <span className="mono">{stats.customerAccountId}</span>
                </>
              )}
            </p>
          </div>
          {identity === undefined ? (
            <Spinner className="h-4 w-4 text-muted" />
          ) : badge && identity ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-3 py-1 text-xs font-medium text-ok" title={`Verified via Self${identity.disclosed.name ? ` — ${identity.disclosed.name}` : ""}`}>
              {badge.label} registered
            </span>
          ) : null}
        </div>

        {identity === null && (
          <div className="flex flex-col gap-3 rounded-2xl border border-warn/30 bg-warnbg/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              <span className="font-semibold">Not registered yet.</span>{" "}
              <span className="text-muted">Prove you're a real person — Aadhaar in India, passport anywhere else — in zero knowledge.</span>
            </p>
            <a href="/verify" className="shrink-0 rounded-lg bg-accent px-4 py-2 text-center text-sm font-medium text-white transition-opacity hover:opacity-90 dark:text-[#1a1917]">
              Register with Self →
            </a>
          </div>
        )}

        {error && <p className="rounded-xl bg-badbg p-4 text-sm text-bad">API unreachable — is the app running?</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="p-6">
            <p className="text-sm text-muted">Purchases</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{settlements ? rows.length : "—"}</p>
            <p className="mt-2 text-xs text-muted">{paid.length} settled · {held.length} held</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted">USDC spent</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{settlements ? usdc(rows.reduce((sum, s) => sum + BigInt(s.usdcAmount), 0n).toString(), 2) : "—"}</p>
            <p className="mt-2 text-xs text-muted">across {paid.length} settlement{paid.length === 1 ? "" : "s"}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted">Budget left</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{budget ? usdc(budget.remainingAtomic, 2) : "no cap"}</p>
            {budget && (
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${Math.min(100, (Number(budget.remainingAtomic) / Math.max(1, Number(budget.limitAtomic))) * 100)}%` }}
                />
              </div>
            )}
            <p className="mt-2 text-xs text-muted">{budget ? `of ${usdc(budget.limitAtomic, 2)} USDC (CUSTOMER_TOTAL_BUDGET)` : "set CUSTOMER_TOTAL_BUDGET to cap spending"}</p>
          </Card>
        </div>

        <Card>
          <CardHead title="Purchases" hint="Newest first." right={<span className="text-xs text-muted">{rows.length} total</span>} />
          {settlements === null ? (
            <p className="flex items-center gap-2 px-5 py-8 text-sm text-muted"><Spinner /> Loading…</p>
          ) : rows.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="font-medium">Nothing bought yet</p>
              <p className="mt-1 text-sm text-muted">Use “Pay as agent” on the settlement desk, or the MCP <span className="mono">buy</span> tool.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="whitespace-nowrap border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                    <th className="px-5 py-3 font-semibold">When</th>
                    <th className="px-3 py-3 font-semibold">Merchant</th>
                    <th className="px-3 py-3 text-right font-semibold">USDC</th>
                    <th className="px-3 py-3 font-semibold">Proof</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} className="border-b border-line transition-colors last:border-0 hover:bg-surface2">
                      <td className="whitespace-nowrap px-5 py-3">
                        <span className="tabular-nums">{clock(s.createdAt)}</span>
                        <span className="ml-2 text-xs text-muted">{timeAgo(s.createdAt, Date.now())}</span>
                      </td>
                      <td className="max-w-[200px] px-3 py-3">
                        <span className="block truncate" title={s.merchant}>{s.merchant}</span>
                        {s.ondc && <span className="block truncate text-xs text-muted" title={s.ondc.providerName}>{s.ondc.providerName} · {s.ondc.items.map((i) => i.name).join(", ")}</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{usdc(s.usdcAmount)}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {isSimTx(s.hederaTxId) ? (
                          <MockTag>simulated</MockTag>
                        ) : (
                          <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={hashscanTx(s.hederaTxId)} target="_blank" rel="noreferrer">
                            {s.hederaTxId.slice(0, 14)}… ↗
                          </a>
                        )}
                        {s.hcsSequence !== null && s.hcsTopicId && (
                          <a className="mono ml-2 text-xs text-accent underline-offset-2 hover:underline" href={hashscanTopic(s.hcsTopicId)} target="_blank" rel="noreferrer">
                            HCS #{s.hcsSequence}
                          </a>
                        )}
                      </td>
                      <td className="px-5 py-3"><StatusPill s={s} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHead title="How the money works" hint="What your agent signs, what you never touch" />
          <div className="px-5 py-3">
            <LedgerRow k="Per payment" v={<span className="text-xs">x402: the agent reads a 402 invoice and signs USDC — you never approve a transaction</span>} />
            <LedgerRow k="Caps" v={<span className="text-xs">CUSTOMER_MAX_PER_PAYMENT per payment · CUSTOMER_TOTAL_BUDGET overall</span>} />
            <LedgerRow k="If held" v={<span className="text-xs">a scheduled refund returns the USDC to this account — immutable, on HashScan</span>} />
            <LedgerRow k="Receipt" v={<span className="text-xs">every settlement gets an HCS receipt, hash-chained to the one before it</span>} />
          </div>
        </Card>
      </main>
    </div>
  );
}
