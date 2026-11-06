"use client";

import { useState } from "react";
import type { Storefront, StoreProduct } from "@/lib/server/products";
import { AgentRunOverlay, runPayAsAgent, useAgentRun } from "../../components/agent-run";
import { Card, RailToggle, useRail } from "../../components/ui";
import { Logo } from "../../components/space/kit";
import { RAIL_NAME, explorerName, rupees, usdc } from "../../dashboard/format";

type Outcome = { ok: boolean; refused?: boolean; text: string; href?: string; signIn?: string };

export function StoreView({ merchant, store, error, buyer }: { merchant: string; store: Storefront | null; error: string | null; buyer: boolean }) {
  const agentRun = useAgentRun();
  const [railPref, setRail] = useRail();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, Outcome>>({});
  const rails = [...new Set((store?.products ?? []).flatMap((p) => p.rails))] as ("hedera" | "whitechain")[];
  const rail = rails.includes(railPref) ? railPref : "hedera";
  const isBakery = merchant.startsWith("bakery.");

  async function buy(p: StoreProduct, hacked = false) {
    const key = `${p.label}${hacked ? ":hacked" : ""}`;
    setBusy(key);
    try {
      const { verdict, body } = hacked
        ? await runPayAsAgent(
            agentRun.run,
            { title: "Buying from a hacked copy of this shop", target: `${p.ensName} · billed 10×` },
            { kind: "hacked", attack: "overcharge", product: p.label, rail },
            "/api/pay",
          )
        : await runPayAsAgent(agentRun.run, { title: `Buying with your agent · ${RAIL_NAME[rail]}`, target: p.ensName }, { ensName: p.ensName, rail }, "/api/agent/buy");
      let o: Outcome;
      if (verdict.kind === "paid") o = { ok: true, text: `Paid ${usdc(String(body?.priceAtomic ?? p.priceUsdcAtomic), 2)} ${body?.rail === "whitechain" ? "USDT" : "USDC"}. The shop gets rupees on UPI.`, href: verdict.hashscan };
      else if (verdict.kind === "refused") o = { ok: true, refused: true, text: `🛡️ Refused, nothing signed. ${verdict.message}` };
      else if (verdict.kind === "soft") o = { ok: false, text: verdict.message, signIn: verdict.signIn };
      else o = { ok: false, text: verdict.message };
      setOutcome((m) => ({ ...m, [p.label]: o }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="space-bar sticky top-3 z-40">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <a href="/" aria-label="Sangam home">
              <Logo />
            </a>
            <span className="text-line">/</span>
            <span className="mono truncate text-sm font-medium">{merchant}</span>
          </div>
          {!buyer && (
            <a href={`/verify?role=user`} className="shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink">
              Sign in to buy
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-5 py-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="mono truncate text-xl font-bold tracking-tight sm:text-2xl">{merchant}</h1>
            <p className="mt-1 text-sm text-muted">
              Every product here has its own ENS name holding its price and this shop&apos;s payout accounts. Agents check it before they pay, so a hacked copy can&apos;t overcharge
              or redirect the money.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {store?.status === "verified" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2.5 py-1 text-xs font-medium text-ok">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" /> verified shop
              </span>
            )}
            <RailToggle rail={rail} onChange={setRail} rails={rails} />
          </div>
        </div>

        {error && <p className="rounded-xl bg-badbg p-4 text-sm text-bad">This shop isn&apos;t on Sangam: {error}</p>}
        {store && store.products.length === 0 && (
          <Card>
            <div className="px-5 py-12 text-center">
              <p className="font-medium">No products yet</p>
              <p className="mt-1 text-sm text-muted">The shop hasn&apos;t published its catalogue on ENS.</p>
            </div>
          </Card>
        )}

        {store && store.products.length > 0 && (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {store.products.map((p) => {
              const o = outcome[p.label];
              return (
                <li key={p.label}>
                  <Card className="h-full">
                    <div className="flex h-full flex-col">
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image} alt="" className="h-40 w-full rounded-t-2xl object-cover" loading="lazy" />
                      ) : (
                        <div aria-hidden className="flex h-28 items-center justify-center rounded-t-2xl bg-surface2 text-3xl">
                          🛍️
                        </div>
                      )}
                      <div className="flex flex-1 flex-col gap-2 p-4">
                        <div>
                          <p className="font-semibold">{p.title}</p>
                          {p.description && <p className="mt-0.5 text-sm text-muted">{p.description}</p>}
                        </div>
                        <a
                          href={`https://sepolia.app.ens.domains/${p.ensName}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mono block truncate text-[11px] text-accent underline-offset-2 hover:underline"
                          title="This product's ENS name: its price and payout accounts, readable by anyone"
                        >
                          {p.ensName} ↗
                        </a>
                        <p className="mt-auto text-lg font-semibold tabular-nums">
                          {rupees(p.priceInrPaise)} <span className="text-xs font-normal text-muted">≈ {usdc(p.priceUsdcAtomic, 2)} {rail === "whitechain" ? "USDT" : "USDC"}</span>
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => buy(p)}
                            disabled={busy !== null}
                            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]"
                          >
                            {busy === p.label ? "Agent is paying…" : "Buy with my agent"}
                          </button>
                          {isBakery && (
                            <button
                              onClick={() => buy(p, true)}
                              disabled={busy !== null}
                              title="A hacked copy of this shop bills 10× the ENS price: the agent should refuse"
                              className="rounded-full border border-bad/40 px-3 py-2 text-xs font-medium transition-colors hover:border-bad disabled:opacity-60"
                            >
                              {busy === `${p.label}:hacked` ? "Checking…" : "Try hacked copy 🛡️"}
                            </button>
                          )}
                        </div>
                        {o && (
                          <p className={`rounded-lg p-2.5 text-xs ${o.refused ? "bg-okbg text-ok" : o.ok ? "bg-surface2 text-muted" : "bg-badbg text-bad"}`} role="status">
                            {o.text}
                            {o.href && (
                              <>
                                {" · "}
                                <a className="text-accent underline-offset-2 hover:underline" href={o.href} target="_blank" rel="noreferrer">
                                  {explorerName(o.href)} ↗
                                </a>
                              </>
                            )}
                            {o.signIn && (
                              <>
                                {" · "}
                                <a className="text-accent underline-offset-2 hover:underline" href={o.signIn}>
                                  Sign in
                                </a>
                              </>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <AgentRunOverlay state={agentRun.state} onClose={agentRun.close} />
    </div>
  );
}
