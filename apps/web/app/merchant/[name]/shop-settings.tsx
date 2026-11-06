"use client";

import { useState, type FormEvent } from "react";
import type { Me } from "@/lib/types";
import { Spinner } from "../../components/ui";

/*
 * The merchant's price and UPI handle, editable from the profile. Both are
 * part of the merchant's ENS record, which buyer agents compare every invoice
 * with, so saving writes them to ENS (one Sepolia transaction).
 */
export function ShopSettings({ me, onSaved }: { me: Me; onSaved: (me: Me) => void }) {
  const shop = me.shop!;
  const [price, setPrice] = useState(String(shop.priceInrPaise / 100));
  const [upi, setUpi] = useState(shop.upiHandle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ tx: string | null; at: string } | null>(null);

  const dirty = Number(price) * 100 !== shop.priceInrPaise || upi.trim().toLowerCase() !== shop.upiHandle;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/merchant/shop", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceInr: Number(price), upiHandle: upi }),
      });
      const body = (await res.json()) as { me?: Me; txs?: { tx: string }[]; offline?: boolean; error?: string };
      if (!res.ok || !body.me) throw new Error(body.error ?? `Save failed (${res.status})`);
      onSaved(body.me);
      setSaved({ tx: body.txs?.at(-1)?.tx ?? null, at: new Date().toLocaleTimeString() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm outline-none transition focus:border-accent disabled:opacity-60";
  return (
    <form onSubmit={save} className="mx-5 mb-5 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">Price and payouts</p>
        <p className="text-[11px] text-muted">Saved to your ENS record</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="shop-price" className="mb-1 block text-xs text-muted">Price per order (₹)</label>
          <input id="shop-price" type="number" min={1} max={100000} step="0.01" required value={price} disabled={busy} onChange={(e) => setPrice(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="shop-upi" className="mb-1 block text-xs text-muted">UPI handle for payouts</label>
          <input id="shop-upi" required value={upi} disabled={busy} onChange={(e) => setUpi(e.target.value)} className={`${input} mono`} placeholder="myshop@okaxis" />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        Agents refuse any bill above the price on ENS, so change it here before you change your checkout.
      </p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-badbg px-3 py-2 text-sm text-bad">{error}</p>}
      {saved && (
        <p className="mt-3 rounded-lg bg-okbg px-3 py-2 text-sm text-ok">
          Saved to ENS at {saved.at}. Agents now check bills against ₹{shop.priceInrPaise / 100}.{" "}
          {saved.tx && (
            <a href={`https://sepolia.etherscan.io/tx/${saved.tx}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
              See the transaction ↗
            </a>
          )}
        </p>
      )}
      <button
        disabled={busy || !dirty}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-medium text-[#0b0d1a] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy && <Spinner />}
        {busy ? "Writing to ENS…" : "Save to ENS"}
      </button>
    </form>
  );
}
