"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ATTACKS, HACKER_ACCOUNT, type Attack, type Inspection, type ShopDef } from "@/lib/demo-shop";
import { AgentRunOverlay, runPayAsAgent, useAgentRun } from "../../components/agent-run";
import { Tilt3D } from "../../components/space/kit";

/*
 * One demo storefront in a browser frame, plus the buyer agent's console.
 * Each page shows its merchant's price and name read from ENS. The railway
 * shop's backend bills that price; the bakery's backend was hacked to bill
 * something else. The visitor can't see the backend, but the agent checks
 * the invoice against ENS before it pays.
 */

export type ShopEns = { name: string; found: boolean; priceInr: number | null; payTo: string | null; status: string | null };

type Line = { text: string; tone?: "ok" | "bad" | "dim" | "plain" };
type Outcome =
  | { kind: "paid"; hashscan?: string }
  | { kind: "checked" }
  | { kind: "refused"; reason: string }
  | { kind: "error"; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ShopWindow({ shop, ens, compact = false }: { shop: ShopDef; ens: ShopEns; compact?: boolean }) {
  const [attack, setAttack] = useState<Attack>("overcharge");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const agentRun = useAgentRun();
  const hacked = shop.variant === "hacked";
  const price = ens.priceInr !== null ? `₹${ens.priceInr}` : "₹—";

  async function run() {
    setBusy(true);
    setOutcome(null);
    const out: Line[] = [];
    const push = async (l: Line, wait = 380) => {
      out.push(l);
      setLines([...out]);
      await sleep(wait);
    };
    try {
      await push({ text: `→ resolve ${ens.name} on ENS`, tone: "dim" });
      const res = await fetch(`/api/demo/inspect?shop=${shop.id}${hacked ? `&attack=${attack}` : ""}`, { cache: "no-store" });
      const data = (await res.json()) as Inspection & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `inspect failed (${res.status})`);
      await push({ text: `  ENS says: ₹${data.ens.priceInr} · pay ${data.ens.payTo} · ${data.ens.status}`, tone: "plain" });
      await push({ text: `→ GET ${new URL(data.invoiceUrl).pathname} → 402 Payment Required`, tone: "dim" });
      await push({ text: `  invoice asks: ${data.invoice.amountUsdc} USDC (≈ ₹${data.invoice.amountInr.toFixed(2)}) → ${data.invoice.payTo}`, tone: "plain" });
      await push({ text: "→ compare the invoice with ENS before signing", tone: "dim" });
      for (const c of data.checks) {
        await push({ text: `  ${c.ok ? "✓" : "✕"} ${c.label}${c.ok ? "" : `: ENS ${c.ens}, invoice ${c.invoice}`}`, tone: c.ok ? "ok" : "bad" }, 520);
      }

      if (data.verdict === "refuse") {
        await push({ text: "✕ refused: nothing signed, no money moved", tone: "bad" }, 0);
        setOutcome({ kind: "refused", reason: data.reason ?? "The invoice doesn't match ENS." });
        return;
      }
      if (shop.id !== "rail") {
        // Only the railway shop is wired to a real purchase in this demo.
        setOutcome({ kind: "checked" });
        return;
      }

      await push({ text: `✓ invoice matches ENS: signing ${data.invoice.amountUsdc} USDC on Hedera…`, tone: "ok" });
      // The one real purchase in the demo, on the honest shop. It drives the
      // hologram overlay; the console transcript stays as the inline record.
      const { verdict, body: paid } = await runPayAsAgent(
        agentRun.run,
        { title: `${shop.brand} · one rail ticket`, target: "tickets.sangam.eth" },
        { kind: "ticket" },
        "/api/pay",
      );
      if (verdict.kind === "soft") {
        await push({ text: "  sign in as a buyer to make the real payment", tone: "dim" }, 0);
        setOutcome({ kind: "checked" });
        return;
      }
      if (verdict.kind === "refused") {
        await push({ text: `✕ refused: nothing signed, no money moved`, tone: "bad" }, 0);
        setOutcome({ kind: "refused", reason: verdict.message });
        return;
      }
      if (verdict.kind === "error") throw new Error(verdict.message);
      await push({ text: `✓ paid · PNR ${(paid?.ticket as { pnr?: string } | undefined)?.pnr ?? "issued"} · settling to UPI`, tone: "ok" }, 0);
      setOutcome({ kind: "paid", hashscan: verdict.hashscan });
    } catch (err) {
      await push({ text: `✕ ${(err as Error).message}`, tone: "bad" }, 0);
      setOutcome({ kind: "error", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <span className={`inline-flex items-center gap-2 text-sm font-medium ${hacked ? "text-bad" : "text-ok"}`}>
          <span className={`h-2 w-2 rounded-full ${hacked ? "bg-bad" : "bg-ok"} shadow-[0_0_10px_currentColor]`} />
          {shop.label}
        </span>
        <span className="hidden text-xs text-muted sm:inline">Price on the page comes from ENS</span>
      </div>

      <Tilt3D max={3}>
        <div className="overflow-hidden rounded-2xl bg-white text-[#0f1222] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.9),0_20px_60px_-30px_rgba(99,102,241,0.6)] ring-1 ring-white/20">
          <div className="flex items-center gap-2 border-b border-black/10 bg-[#eef0f6] px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#f08a80]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#f0c062]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#6fd3a0]" />
            <span className="mono ml-2 min-w-0 flex-1 truncate rounded-md bg-white px-2 py-0.5 text-[11px] text-black/55">🔒 {shop.address}</span>
          </div>
          {shop.id === "bakery" ? (
            <BakeryFront shop={shop} ens={ens} price={price} busy={busy} onBuy={run} compact={compact} />
          ) : (
            <RailFront shop={shop} ens={ens} price={price} busy={busy} onBuy={run} compact={compact} />
          )}
        </div>
      </Tilt3D>

      {hacked && (
        <div className="rounded-2xl border border-bad/30 bg-badbg/40 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-bad">Behind the page · what the hacker changed</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {ATTACKS.map((a) => (
              <button
                key={a.id}
                onClick={() => setAttack(a.id)}
                disabled={busy}
                title={a.detail}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${attack === a.id ? "bg-bad text-[#0b0d1a]" : "bg-white/5 text-muted ring-1 ring-white/10 hover:text-ink"}`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <pre className="mono mt-3 overflow-x-auto rounded-lg bg-black/40 p-3 text-[11.5px] leading-relaxed">
            <span className="text-muted">{"// backend: writes the 402 invoice\n"}</span>
            {attack === "redirect" ? (
              <span className="text-muted">{"amount: ensPrice,\n"}</span>
            ) : (
              <>
                <span className="text-muted line-through">{"- amount: ensPrice,\n"}</span>
                <span className="text-bad">{"+ amount: ensPrice * 10,\n"}</span>
              </>
            )}
            {attack === "overcharge" ? (
              <span className="text-muted">{"payTo:  ens.payTo,"}</span>
            ) : (
              <>
                <span className="text-muted line-through">{"- payTo:  ens.payTo,\n"}</span>
                <span className="text-bad">{`+ payTo:  "${HACKER_ACCOUNT}",`}</span>
              </>
            )}
          </pre>
        </div>
      )}

      <div className="glass-3d rounded-2xl p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Buyer agent</span>
          <span className="mono text-[11px] text-muted">checks ENS before it signs</span>
        </div>
        <div className="mono min-h-[168px] space-y-1 text-[12px] leading-relaxed">
          {lines.length === 0 && <p className="text-muted">Press “Buy with my AI agent” to watch it check the invoice.</p>}
          {lines.map((l, i) => (
            <motion.p
              key={i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              className={`break-words ${l.tone === "ok" ? "text-ok" : l.tone === "bad" ? "text-bad" : l.tone === "dim" ? "text-muted" : "text-ink"}`}
            >
              {l.text}
            </motion.p>
          ))}
        </div>
        <AnimatePresence>{outcome && <OutcomeBanner outcome={outcome} />}</AnimatePresence>
      </div>
      <AgentRunOverlay state={agentRun.state} onClose={agentRun.close} />
    </div>
  );
}

type FrontProps = { shop: ShopDef; ens: ShopEns; price: string; busy: boolean; onBuy: () => void; compact: boolean };

function EnsBadge({ ens, tone }: { ens: ShopEns; tone: string }) {
  return (
    <span className={`inline-flex max-w-[60%] items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[11px] font-medium ${tone}`}>
      ENS · {ens.name} {ens.status === "verified" ? "✓" : ""}
    </span>
  );
}

function NotOnEns({ ens }: { ens: ShopEns }) {
  if (ens.found) return null;
  return (
    <p className="mt-3 rounded-lg bg-[#fff4e0] px-3 py-2 text-[12px] text-[#8a5a00]">
      {ens.name} isn&apos;t on ENS yet, so there is no price to show. Register it with <span className="mono">npm run add-merchant</span>.
    </p>
  );
}

function RailFront({ shop, ens, price, busy, onBuy, compact }: FrontProps) {
  return (
    <div className={compact ? "p-5" : "p-6 sm:p-8"}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-lg font-bold tracking-tight text-[#3b2fd6]">{shop.brand}</span>
        <EnsBadge ens={ens} tone="bg-[#eef0ff] text-[#3b2fd6]" />
      </div>
      <div className="mt-5 rounded-xl border border-black/10 p-4">
        <div className="text-xs uppercase tracking-[0.14em] text-black/45">{shop.product.subtitle}</div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <div className="text-xl font-semibold tracking-tight">{shop.product.title}</div>
          <div className="text-2xl font-bold tracking-tight">{price}</div>
        </div>
        <div className="mt-1 text-sm text-black/50">{shop.product.detail} · price from ENS</div>
      </div>
      <NotOnEns ens={ens} />
      <button
        onClick={onBuy}
        disabled={busy}
        className="mt-5 flex w-full items-center justify-center rounded-full bg-[#0f1222] px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 disabled:opacity-60"
      >
        {busy ? "Agent is checking…" : `Buy ticket with my AI agent · ${price}`}
      </button>
    </div>
  );
}

function BakeryFront({ shop, ens, price, busy, onBuy, compact }: FrontProps) {
  return (
    <div className={`bg-[#fff8f1] ${compact ? "p-5" : "p-6 sm:p-8"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-serif text-xl font-semibold italic tracking-tight text-[#7a3e1d]">{shop.brand}</span>
        <EnsBadge ens={ens} tone="bg-[#f6e3d3] text-[#7a3e1d]" />
      </div>
      <div className="mt-5 flex gap-4 rounded-xl border border-[#7a3e1d]/15 bg-white p-4">
        {/* a small drawn cake, so the shop has a picture without an image file */}
        <div aria-hidden className="relative h-[76px] w-[76px] shrink-0 rounded-xl bg-[#fde8d7]">
          <div className="absolute inset-x-3 bottom-3 h-7 rounded-md bg-[#5b2c16]" />
          <div className="absolute inset-x-3 bottom-[34px] h-4 rounded-t-md bg-[#7a3e1d]" />
          <div className="absolute inset-x-3 bottom-[46px] h-2 rounded-full bg-[#f4c3a8]" />
          <div className="absolute bottom-[48px] left-1/2 h-4 w-1 -translate-x-1/2 rounded bg-[#e86a5c]" />
          <div className="absolute bottom-[62px] left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-[#f0c062]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-[0.14em] text-[#7a3e1d]/60">{shop.product.subtitle}</div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <div className="text-lg font-semibold tracking-tight">{shop.product.title}</div>
            <div className="text-2xl font-bold tracking-tight">{price}</div>
          </div>
          <div className="mt-1 text-sm text-black/50">{shop.product.detail}</div>
        </div>
      </div>
      <NotOnEns ens={ens} />
      <button
        onClick={onBuy}
        disabled={busy}
        className="mt-5 flex w-full items-center justify-center rounded-full bg-[#7a3e1d] px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 disabled:opacity-60"
      >
        {busy ? "Agent is checking…" : `Order cake with my AI agent · ${price}`}
      </button>
    </div>
  );
}

function OutcomeBanner({ outcome }: { outcome: Outcome }) {
  const base = "mt-4 rounded-xl px-4 py-3 text-sm";
  const anim = { initial: { opacity: 0, y: 8, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0 } };
  if (outcome.kind === "refused")
    return (
      <motion.div {...anim} className={`${base} bg-badbg text-bad ring-1 ring-bad/30`}>
        <div className="font-semibold">Payment refused. Nothing was signed, no money moved.</div>
        <div className="mt-1 text-[13px] text-bad/85">{outcome.reason}</div>
      </motion.div>
    );
  if (outcome.kind === "paid")
    return (
      <motion.div {...anim} className={`${base} bg-okbg text-ok ring-1 ring-ok/30`}>
        <div className="font-semibold">Paid. The merchant gets rupees on UPI.</div>
        {outcome.hashscan && (
          <a href={outcome.hashscan} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[13px] underline-offset-2 hover:underline">
            {outcome.hashscan.includes("whitechain") ? "See the USDT transfer on the Whitechain explorer ↗" : "See the USDC transfer on HashScan ↗"}
          </a>
        )}
      </motion.div>
    );
  if (outcome.kind === "checked")
    return (
      <motion.div {...anim} className={`${base} bg-okbg text-ok ring-1 ring-ok/30`}>
        <div className="font-semibold">Invoice matches ENS. The agent would pay.</div>
        <a href="/verify?role=user" className="mt-1 inline-block text-[13px] underline-offset-2 hover:underline">
          Sign in as a buyer to make the real payment →
        </a>
      </motion.div>
    );
  return (
    <motion.div {...anim} className={`${base} bg-warnbg text-warn ring-1 ring-warn/30`}>
      {outcome.message}
    </motion.div>
  );
}
