"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BargainArena, type BargainData } from "../buyer/bargain-arena";

/*
 * Local preview of agent-to-agent bargaining — the two agents haggling, with no
 * auth, ENS, wallet or payment. Set a price and the merchant's margin, hit the
 * button, and watch the buyer and merchant agents fight over the price. Uses the
 * real /api/bargain/demo engine (deterministic by default, so it's instant).
 */

type Result = BargainData;

export default function BargainPreviewPage() {
  const [priceRs, setPriceRs] = useState(500);
  const [marginPct, setMarginPct] = useState(5);
  const [product, setProduct] = useState("truffle-cake.bakery.sangam.eth");
  const [useModel, setUseModel] = useState(false);
  const [data, setData] = useState<Result | null>(null);
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => () => clearTimers(), []);

  const run = useCallback(async () => {
    clearTimers();
    setBusy(true);
    setError(null);
    setData(null);
    setShown(0);
    try {
      const res = await fetch("/api/bargain/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product, listPaise: Math.round(priceRs * 100), bargainBps: Math.round(marginPct * 100), useModel }),
      });
      const body = (await res.json()) as Result & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `failed (${res.status})`);
      setData(body);
      setShown(1);
      for (let i = 2; i <= body.rounds.length; i++) timers.current.push(setTimeout(() => setShown(i), (i - 1) * 900));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [product, priceRs, marginPct, useModel]);

  const done = data ? shown >= data.rounds.length : false;

  return (
    <main className="min-h-screen bg-bg px-6 py-12 text-ink">
      <div className="mx-auto max-w-lg space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents bargaining — preview</h1>
          <p className="mt-1 text-sm text-muted">Two agents haggle over the price, capped at the merchant's margin. No login, no payment — just the negotiation.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-surface p-4">
          <label className="col-span-2 text-xs text-muted">Product (ENS name)
            <input value={product} onChange={(e) => setProduct(e.target.value)} className="mono mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">List price (₹)
            <input type="number" value={priceRs} min={1} onChange={(e) => setPriceRs(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">Merchant margin (%)
            <input type="number" value={marginPct} min={0} max={50} onChange={(e) => setMarginPct(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={useModel} onChange={(e) => setUseModel(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
            Use 0G Compute for the offers (needs 0G configured; otherwise falls back automatically)
          </label>
          <button onClick={() => void run()} disabled={busy} className="col-span-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]">
            {busy ? "…" : data ? "⚔︎ Make them fight again" : "⚔︎ Make them fight"}
          </button>
        </div>

        {error && <p className="rounded-xl bg-badbg px-3 py-2 text-sm text-bad">{error}</p>}

        {data && (
          <div className="rounded-3xl border border-line bg-surface p-5 shadow-xl">
            <BargainArena data={data} shown={shown} done={done} />
          </div>
        )}
      </div>
    </main>
  );
}
