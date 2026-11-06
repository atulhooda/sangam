import type { Metadata } from "next";
import { SHOPS } from "@/lib/demo-shop";
import { DemoHeader } from "./demo-header";
import { loadShopEns } from "./load-ens";
import { ShopWindow } from "./shop-window";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Honest shop vs hacked shop · Sangam" };

export default async function DemoShops() {
  const [rail, bakery] = await Promise.all([loadShopEns("rail"), loadShopEns("bakery")]);
  // Where the two shops run as their own websites (separate Railway services), if they do.
  const sites = { rail: process.env.RAILKART_URL?.trim() || null, bakery: process.env.BAKERY_URL?.trim() || null };
  return (
    <div className="min-h-screen">
      <DemoHeader title="Live demo: honest shop vs hacked shop" />
      <main id="main" className="mx-auto max-w-6xl px-5 pb-20 pt-10">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em] text-indigo-300/80">ENS is the source of truth</p>
          <h1 className="text-balance text-3xl font-medium tracking-[-0.035em] sm:text-5xl">
            <span className="block text-white">Two Sangam merchants.</span>
            <span className="block text-white/45">One backend is lying.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">
            A railway ticket site and a bakery, each with a verified ENS name that holds its price and payout account. The bakery&apos;s
            page still shows its real price, but its backend was hacked to bill more, or to send the money elsewhere. Before signing
            anything, the buyer agent compares each invoice with the merchant&apos;s ENS record. The railway shop gets paid; the hacked
            bakery gets nothing.
          </p>
        </div>
        {(sites.rail || sites.bakery) && (
          <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm">
            {sites.rail && (
              <a href={sites.rail} target="_blank" rel="noreferrer" className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-muted hover:text-ink">
                Open RailKart&apos;s website ↗
              </a>
            )}
            {sites.bakery && (
              <a href={sites.bakery} target="_blank" rel="noreferrer" className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-muted hover:text-ink">
                Open Crumbs &amp; Co.&apos;s website ↗
              </a>
            )}
          </div>
        )}
        <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-8">
          <ShopWindow shop={SHOPS.rail} ens={rail} compact />
          <ShopWindow shop={SHOPS.bakery} ens={bakery} compact />
        </div>
      </main>
    </div>
  );
}
