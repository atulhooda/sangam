"use client";

import { useEffect, useState } from "react";
import type { EnsView, Settlement } from "@/lib/types";
import { Card, CardHead, LedgerRow, MockTag, Spinner, StatusPill, idBadge } from "../../components/ui";
import { ThemeToggle } from "../../components/theme-toggle";
import { clock, hashscanTopic, hashscanTx, isSimTx, rupees, timeAgo, usdc } from "../../dashboard/format";

/*
 * The merchant desk: everything this merchant cares about, and nothing else.
 * No login — the ENS name is the account, and the padlock is the Self proof:
 * registration is a zero-knowledge Aadhaar (or passport) verification at
 * /verify; until it's done, the desk shows the banner instead of the money.
 */

type Identity = {
  nullifier: string;
  role: "merchant" | "user";
  label: string;
  attestationId: number;
  disclosed: Record<string, string>;
  verifiedAt: string;
};

export function MerchantDesk({ name }: { name: string }) {
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [ens, setEns] = useState<EnsView | { error: string } | null>(null);
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const rows = (await (await fetch(`/api/settlements?merchant=${encodeURIComponent(name)}`, { cache: "no-store" })).json()) as Settlement[];
        if (alive) {
          setSettlements(rows);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    }
    fetch(`/api/ens?name=${encodeURIComponent(name)}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<EnsView>)
      .then(setEns)
      .catch(() => setEns({ error: "Could not load ENS records" }));
    fetch("/api/self/identities", { cache: "no-store" })
      .then((r) => r.json() as Promise<Identity[]>)
      .then((rows) => setIdentity(rows.find((i) => i.role === "merchant" && i.label.toLowerCase() === name.toLowerCase()) ?? null))
      .catch(() => setIdentity(null));
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [name]);

  const rows = settlements ?? [];
  const paid = rows.filter((s) => s.status === "paid");
  const usdcIn = rows.reduce((sum, s) => sum + BigInt(s.usdcAmount), 0n);
  const inrPaid = paid.reduce((sum, s) => sum + (s.payoutPaise ?? 0), 0);
  const view = ens && !("error" in ens) ? ens : null;
  const badge = identity ? idBadge(identity.attestationId) : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <a href="/" className="text-lg font-bold tracking-tight text-accent">sangam</a>
            <span className="text-line">/</span>
            <span className="text-sm font-medium">Merchant desk</span>
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
            <h1 className="mono text-xl font-bold tracking-tight text-accent sm:text-2xl">{name}</h1>
            <p className="mt-1 text-sm text-muted">Your settlements: agents pay USDC, you get rupees.</p>
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
              <span className="text-muted">Verify with your Aadhaar (or passport, if you're outside India) to open this desk — it takes a minute and reveals nothing about your ID.</span>
            </p>
            <a href="/verify" className="shrink-0 rounded-lg bg-accent px-4 py-2 text-center text-sm font-medium text-white transition-opacity hover:opacity-90 dark:text-[#1a1917]">
              Register with Self →
            </a>
          </div>
        )}

        {error && <p className="rounded-xl bg-badbg p-4 text-sm text-bad">API unreachable — is the app running?</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="p-6">
            <p className="text-sm text-muted">Rupees paid out</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{settlements ? rupees(inrPaid) : "₹—"}</p>
            <p className="mt-2 text-xs text-muted">{paid.length} UPI payout{paid.length === 1 ? "" : "s"}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted">USDC received</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{settlements ? usdc(usdcIn.toString(), 2) : "—"}</p>
            <p className="mt-2 text-xs text-muted">across {rows.length} payment{rows.length === 1 ? "" : "s"}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted">Held</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{settlements ? rows.filter((s) => s.status === "held").length : "—"}</p>
            <p className="mt-2 text-xs text-muted">held payments get a scheduled USDC refund</p>
          </Card>
        </div>

        <Card>
          <CardHead title="Your payments" hint="Newest first." right={<span className="text-xs text-muted">{rows.length} total</span>} />
          {settlements === null ? (
            <p className="flex items-center gap-2 px-5 py-8 text-sm text-muted"><Spinner /> Loading…</p>
          ) : rows.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="font-medium">No payments yet</p>
              <p className="mt-1 text-sm text-muted">When an agent buys from you over x402, it shows up here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="whitespace-nowrap border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                    <th className="px-5 py-3 font-semibold">When</th>
                    <th className="px-3 py-3 text-right font-semibold">USDC in</th>
                    <th className="px-3 py-3 text-right font-semibold">₹ paid out</th>
                    <th className="px-3 py-3 font-semibold">UPI ref</th>
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
                      <td className="px-3 py-3 text-right tabular-nums">{usdc(s.usdcAmount)}</td>
                      <td className={`px-3 py-3 text-right tabular-nums ${s.status === "paid" ? "font-medium" : "text-muted"}`}>
                        {s.payoutPaise !== null && s.status === "paid" ? rupees(s.payoutPaise) : s.status === "held" ? "held" : "—"}
                      </td>
                      <td className="max-w-[140px] px-3 py-3">
                        <span className="mono block truncate text-xs" title={s.payoutRef ?? ""}>{s.payoutRef ?? "—"}</span>
                      </td>
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

        {view && (
          <Card>
            <CardHead
              title="Your ENS record — what agents read"
              hint={view.source === "ens" ? "Live from ENSv2 on Sepolia" : "From the offline merchant file"}
              right={
                view.source === "ens" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2 py-0.5 text-[11px] font-medium text-ok">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" /> live
                  </span>
                ) : (
                  <MockTag>ENS offline</MockTag>
                )
              }
            />
            <div className="rounded-lg bg-surface2 px-3 py-1 m-5 mt-4">
              {view.records.map((r) => (
                <LedgerRow key={r.key} k={r.key} v={<span className="mono text-[11px]" title={r.value}>{r.value}</span>} />
              ))}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
