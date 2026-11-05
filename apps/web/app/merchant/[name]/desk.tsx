"use client";

import { useEffect, useState } from "react";
import type { EnsView, Me, Settlement } from "@/lib/types";
import { Card, CardHead, LedgerRow, MockTag, Spinner, StatusPill, idBadge } from "../../components/ui";
import { Logo } from "../../components/space/kit";
import { AccountMenu } from "../../components/account-menu";
import { clock, hashscanTopic, hashscanTx, isSimTx, rupees, timeAgo, usdc } from "../../dashboard/format";

/*
 * The merchant desk: everything this merchant cares about, and nothing else.
 * page.tsx lets in only the merchant who proved this ENS name with Self and
 * has a company certificate on file; buyers and other merchants are sent away
 * on the server, before this renders.
 */

export function MerchantDesk({ name, me: initialMe }: { name: string; me: Me }) {
  const [me, setMe] = useState(initialMe);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function retrySetup() {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch("/api/merchant/provision", { method: "POST" });
      const body = (await res.json()) as { me?: Me; error?: string };
      if (body.me) setMe(body.me);
      if (!res.ok && body.error) setRetryError(body.error);
    } catch (err) {
      setRetryError((err as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [ens, setEns] = useState<EnsView | { error: string } | null>(null);
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
  const badge = idBadge(me.attestationId);

  return (
    <div className="min-h-screen">
      <header className="space-bar sticky top-3 z-40">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <a href="/" aria-label="Sangam home"><Logo /></a>
            <span className="text-line">/</span>
            <span className="text-sm font-medium">Merchant desk</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="hidden rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink sm:block">
              Settlement desk →
            </a>
            <AccountMenu me={me} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-5 py-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="mono text-xl font-bold tracking-tight text-accent sm:text-2xl">{name}</h1>
            <p className="mt-1 text-sm text-muted">Your settlements: agents pay USDC, you get rupees.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-3 py-1 text-xs font-medium text-ok" title={`Verified via Self${me.name ? ` — ${me.name}` : ""}`}>
            {badge.label} verified · certificate on file
          </span>
        </div>

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

        {me.shop && (
          <Card>
            <CardHead
              title="Your name and deposit account"
              hint="Set up by Sangam after your certificate. Agents read these from ENS."
              right={
                me.shop.provisionedAt ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2 py-0.5 text-[11px] font-medium text-ok">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" /> verified on ENS
                  </span>
                ) : (
                  <span className="rounded-full bg-warnbg px-2 py-0.5 text-[11px] font-medium text-warn">not set up yet</span>
                )
              }
            />
            <div className="m-5 mt-4 rounded-lg bg-surface2 px-3 py-1">
              <LedgerRow
                k="Deposit account"
                v={
                  me.shop.depositAccountId ? (
                    <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={`https://hashscan.io/testnet/account/${me.shop.depositAccountId}`} target="_blank" rel="noreferrer">
                      {me.shop.depositAccountId} ↗
                    </a>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )
                }
              />
              <LedgerRow k="UPI payouts" v={<span className="mono text-xs">{me.shop.upiHandle}</span>} />
              <LedgerRow k="Price per order" v={<span className="text-xs">{rupees(me.shop.priceInrPaise)}</span>} />
              <LedgerRow k="Agents buy at" v={<span className="mono block max-w-[260px] truncate text-[11px]" title={me.shop.publishedUrl ?? ""}>{me.shop.publishedUrl ?? "—"}</span>} />
              {me.shop.ensTxs.map((t) => (
                <LedgerRow
                  key={t.tx}
                  k={`ENS ${t.step}`}
                  v={
                    <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={`https://sepolia.etherscan.io/tx/${t.tx}`} target="_blank" rel="noreferrer">
                      {t.tx.slice(0, 12)}… ↗
                    </a>
                  }
                />
              ))}
            </div>
            {!me.shop.provisionedAt && (
              <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-bad">{retryError ?? me.shop.error ?? "Setup hasn't finished."} Agents can't pay you until it does.</p>
                <button
                  onClick={retrySetup}
                  disabled={retrying}
                  className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]"
                >
                  {retrying ? "Setting up… (up to a minute)" : "Retry setup"}
                </button>
              </div>
            )}
          </Card>
        )}

        {me.cert && (
          <Card>
            <CardHead
              title="Company certificate"
              hint="Only you can open this file. Uploaded after your Self sign-in."
              right={<span className="rounded-full bg-warnbg px-2 py-0.5 text-[11px] font-medium text-warn">submitted · awaiting review</span>}
            />
            <div className="m-5 mt-4 rounded-lg bg-surface2 px-3 py-1">
              <LedgerRow k="Company" v={<span className="text-xs">{me.cert.companyName}</span>} />
              <LedgerRow k="Registration no." v={<span className="mono text-xs">{me.cert.registrationNumber}</span>} />
              <LedgerRow
                k="File"
                v={
                  <a className="text-xs text-accent underline-offset-2 hover:underline" href="/api/merchant/cert" target="_blank" rel="noreferrer">
                    {me.cert.fileName} ↗
                  </a>
                }
              />
              <LedgerRow k="Uploaded" v={<span className="text-xs">{timeAgo(me.cert.uploadedAt, Date.now())}</span>} />
            </div>
            <p className="px-5 pb-4 text-xs text-muted">
              Wrong file or details? <a className="text-accent underline-offset-2 hover:underline" href="/merchant/onboarding?replace=1">Update them</a>.
            </p>
          </Card>
        )}

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
