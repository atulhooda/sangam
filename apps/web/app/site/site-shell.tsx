import type { ReactNode } from "react";
import type { ShopDef } from "@/lib/demo-shop";
import { SangamMark } from "../components/space/kit";
import type { ShopEns } from "../demo/shops/shop-window";

/*
 * The frame of a shop's own website (served at "/" on that shop's domain):
 * the shop's brand and menu, its storefront, and a footer saying who
 * processes the payment. No Sangam navigation: to a visitor this is the shop.
 */
export function SiteShell({ shop, ens, menu, tagline, children }: { shop: ShopDef; ens: ShopEns; menu: string[]; tagline: string; children: ReactNode }) {
  const bakery = shop.id === "bakery";
  return (
    <div className="dark relative min-h-screen">
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 -z-10 ${
          bakery
            ? "bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(194,120,74,0.30),transparent_70%)]"
            : "bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(79,70,229,0.35),transparent_70%)]"
        }`}
      />
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-6">
        <span className={`text-xl font-bold tracking-tight ${bakery ? "font-serif italic text-[#f3c9a6]" : "text-white"}`}>{shop.brand}</span>
        <nav aria-label={`${shop.brand} menu`} className="hidden gap-6 text-sm text-white/55 sm:flex">
          {menu.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </nav>
      </header>

      <main id="main" className="mx-auto grid max-w-5xl items-start gap-10 px-5 pb-16 pt-4 lg:grid-cols-[1fr_1.15fr]">
        <div className="lg:pt-10">
          <p className={`mb-4 text-[11px] font-medium uppercase tracking-[0.2em] ${bakery ? "text-[#f3c9a6]/80" : "text-indigo-300/80"}`}>{tagline}</p>
          <h1 className="text-balance text-4xl font-medium tracking-[-0.035em] sm:text-5xl">
            <span className="block text-white">{bakery ? "Fresh from the oven." : "Book a seat in seconds."}</span>
            <span className="block text-white/45">{bakery ? "Ordered by your AI agent." : "Paid by your AI agent."}</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/55">
            {shop.brand} accepts payments from AI agents in USDC and gets paid in rupees through Sangam. Our price and payout account are
            published on ENS as <span className="mono text-white/80">{ens.name}</span>, so any agent can check a bill before it pays.
          </p>
        </div>
        {children}
      </main>

      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-white/40">
          <span>
            © {shop.brand} · {shop.address.split("/")[0]}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <SangamMark size={12} className="text-blue-400" /> Payments by Sangam · verified on ENS as {ens.name}
          </span>
        </div>
      </footer>
    </div>
  );
}
