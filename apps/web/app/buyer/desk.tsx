"use client";

import { useEffect, useState } from "react";
import type { Me, Settlement, Stats } from "@/lib/types";
import { Card, CardHead, LedgerRow, MockTag, Spinner, StatusPill, idBadge } from "../components/ui";
import { ThemeToggle } from "../components/theme-toggle";
import { AccountMenu } from "../components/account-menu";
import { clock, hashscanTopic, hashscanTx, isSimTx, rupees, timeAgo, usdc } from "../dashboard/format";

/*
 * The buyer desk: what this buyer's agent has bought, and what's left to
 * spend. Only a buyer signed in with Self reaches it (page.tsx checks the
 * session on the server). The agent's identity is its Hedera account
 * (CUSTOMER_ACCOUNT_ID).
 */

export function BuyerDesk({ me }: { me: Me }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);

  // Sent here from a merchant desk? Say why.
  useEffect(() => {
    setDenied(new URLSearchParams(window.location.search).get("denied") === "merchant");
  }, []);

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
  const badge = idBadge(me.attestationId);

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
            <a href="/dashboard" className="hidden rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink sm:block">
              Settlement desk →
            </a>
            <AccountMenu me={me} />
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
          <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-3 py-1 text-xs font-medium text-ok" title={`Verified via Self${me.name ? ` — ${me.name}` : ""}`}>
            {badge.label} verified
          </span>
        </div>

        {denied && (
          <p className="rounded-2xl border border-warn/30 bg-warnbg/60 px-5 py-4 text-sm" role="status">
            <span className="font-semibold">Merchant desks are for merchants.</span>{" "}
            <span className="text-muted">You're signed in as a buyer. To run a merchant desk, sign out and sign in as a merchant with your company certificate.</span>
          </p>
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
