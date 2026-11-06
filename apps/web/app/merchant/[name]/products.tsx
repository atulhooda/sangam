"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHead, Spinner } from "../../components/ui";
import { rupees, usdc } from "../../dashboard/format";

/*
 * The merchant's catalogue: upload products in bulk (CSV), check them, publish.
 * Each product becomes its own ENS name under the shop's, carrying its price
 * and the shop's payout accounts; the storefront is rebuilt from ENS.
 */

type Row = { line: number; label?: string; error?: string; input?: { title: string; priceInrPaise: number; description?: string; image?: string } };
type Job = { state: "running" | "done" | "failed"; done: number; total: number; current: string; log: string[]; txs: { step: string; tx: string }[]; error: string | null };
type StoreProduct = { label: string; ensName: string; title: string; priceInrPaise: number; priceUsdcAtomic: string; image: string; rails: string[] };
type View = { merchant: string; job: Job | null; store: { products: StoreProduct[]; errors: string[] } | { error: string } | null };

const SAMPLE = `name,price_inr,description,image_url
Chocolate truffle cake,450,"1 kg, eggless",
Butter croissant,80,Baked every morning,
Sourdough loaf,220,48-hour ferment,`;

export function ProductsCard({ merchant }: { merchant: string }) {
  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "publish" | null>(null);
  const [view, setView] = useState<View | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setView((await (await fetch("/api/merchant/products", { cache: "no-store" })).json()) as View);
    } catch {
      /* next poll */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While publishing, poll every 2 s.
  const running = view?.job?.state === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [running, load]);

  async function submit(dryRun: boolean) {
    setBusy(dryRun ? "check" : "publish");
    setError(null);
    try {
      const res = await fetch("/api/merchant/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv, dryRun }) });
      const body = (await res.json()) as { rows?: Row[]; error?: string; job?: Job };
      setRows(body.rows ?? null);
      if (body.error) setError(body.error);
      if (!dryRun && res.ok) await load();
    } finally {
      setBusy(null);
    }
  }

  async function pickFile(f: File | undefined) {
    if (!f) return;
    setCsv(await f.text());
    setRows(null);
    setError(null);
  }

  const job = view?.job ?? null;
  const store = view?.store && "products" in view.store ? view.store : null;
  const good = rows?.filter((r) => r.input) ?? [];
  const bad = rows?.filter((r) => r.error) ?? [];
  const storeUrl = `/store/${encodeURIComponent(merchant)}`;

  return (
    <Card>
      <CardHead
        title="Products"
        hint="Upload your catalogue. Each product gets its own ENS name, so agents check its price before paying."
        right={
          <a href={storeUrl} target="_blank" rel="noreferrer" className="text-xs text-accent underline-offset-2 hover:underline">
            Open your storefront ↗
          </a>
        }
      />
      <div className="space-y-3 p-5">
        {store && store.products.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {store.products.map((p) => (
              <li key={p.label} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <p className="mono truncate text-[11px] text-muted">{p.ensName}</p>
                </div>
                <span className="text-sm tabular-nums">
                  {rupees(p.priceInrPaise)} <span className="text-xs text-muted">≈ {usdc(p.priceUsdcAtomic, 2)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {job && (
          <div className={`rounded-xl px-4 py-3 text-sm ${job.state === "failed" ? "bg-badbg text-bad" : job.state === "done" ? "bg-okbg text-ok" : "bg-surface2"}`} role="status">
            {job.state === "running" && (
              <>
                <p className="flex items-center gap-2 font-medium">
                  <Spinner className="h-3.5 w-3.5" /> Publishing on ENS… {job.done} of {job.total}
                </p>
                {job.current && <p className="mono mt-1 truncate text-[11px] text-muted">{job.current}</p>}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(job.done / Math.max(1, job.total)) * 100}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-muted">{job.log.at(-1) ?? "starting…"} Each product is a Sepolia transaction; this takes a few minutes.</p>
              </>
            )}
            {job.state === "done" && (
              <p>
                ✓ {job.total} product{job.total === 1 ? "" : "s"} live on ENS ({job.txs.length} transactions).{" "}
                <a href={storeUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  See the storefront ↗
                </a>
              </p>
            )}
            {job.state === "failed" && <p>Publishing stopped: {job.error}</p>}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              One product per line: <span className="mono">name, price_inr, description, image_url</span>
            </span>
            <span className="flex gap-3">
              <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => setCsv(SAMPLE)}>
                Use sample
              </button>
              <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => file.current?.click()}>
                Upload .csv
              </button>
              <input ref={file} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
            </span>
          </div>
          <textarea
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setRows(null);
            }}
            rows={6}
            spellCheck={false}
            placeholder={SAMPLE}
            aria-label="Products, as CSV"
            className="mono w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-accent"
          />
        </div>

        {rows && rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Line</th>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">ENS name</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.line} className={r.error ? "bg-badbg/60" : ""}>
                    <td className="px-3 py-2 tabular-nums text-muted">{r.line}</td>
                    {r.error ? (
                      <td colSpan={3} className="px-3 py-2 text-bad">
                        {r.error}
                      </td>
                    ) : (
                      <>
                        <td className="px-3 py-2">{r.input!.title}</td>
                        <td className="px-3 py-2 tabular-nums">{rupees(r.input!.priceInrPaise)}</td>
                        <td className="mono px-3 py-2 text-[11px] text-muted">
                          {r.label}.{merchant}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-badbg p-3 text-xs text-bad" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => submit(true)}
            disabled={!csv.trim() || busy !== null || running}
            className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-medium transition-colors hover:border-accent disabled:opacity-50"
          >
            {busy === "check" ? "Checking…" : "Check"}
          </button>
          <button
            onClick={() => submit(false)}
            disabled={!rows || good.length === 0 || bad.length > 0 || busy !== null || running}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]"
            title={!rows ? "Check the list first" : bad.length ? "Fix the flagged lines first" : undefined}
          >
            {busy === "publish" ? "Starting…" : `Publish ${good.length || ""} on ENS`}
          </button>
        </div>
      </div>
    </Card>
  );
}
