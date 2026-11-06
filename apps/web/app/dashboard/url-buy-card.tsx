"use client";

import { useState } from "react";
import type { Stats } from "@/lib/types";
import { runPayAsAgent, type RunOutcome } from "../components/agent-run";
import { Card, CardHead, Spinner } from "../components/ui";

/*
 * "Buy from any URL": paste any website link and the agent attempts an x402
 * purchase at it, with the full safety net — the site must answer with a real
 * 402 x402 invoice, the invoice must pass the verified-merchants-only ENS
 * checks, and the page must live on the merchant's registered ENS endpoint
 * (origin-mismatch). Anything else: a friendly answer and nothing signed.
 */

type UrlMsg = { tone: "refused" | "notx402" | "ok" | "bad"; text: string; href?: string };

export function UrlBuyCard({
  stats,
  run,
  onSent,
}: {
  stats: Stats | null;
  run: (cfg: { title: string; target: string }, doFetch: () => Promise<RunOutcome>) => Promise<RunOutcome>;
  onSent: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<UrlMsg | null>(null);
  const canPay = stats?.actions.payAsAgent ?? false;

  async function buy() {
    const link = url.trim();
    if (!link || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const { verdict, body } = await runPayAsAgent(run, { title: "Buying from a pasted link", target: link }, { kind: "url", url: link }, "/api/pay");
      if (verdict.kind === "refused") {
        setMsg({ tone: "refused", text: `🛡️ Agent refused to pay, nothing was signed. ${verdict.message}` });
      } else if (verdict.kind === "soft") {
        setMsg({ tone: "notx402", text: verdict.message });
      } else if (verdict.kind === "error") {
        setMsg({ tone: body?.notX402 ? "notx402" : "bad", text: verdict.message });
      } else if (verdict.kind === "paid") {
        const tx = typeof body?.hederaTxId === "string" ? body.hederaTxId : "";
        setMsg({ tone: "ok", text: `Paid ${tx ? tx.slice(0, 12) + "…" : ""} — see the USDC transfer on HashScan.`, href: verdict.hashscan });
        onSent();
      }
    } finally {
      setBusy(false);
    }
  }

  const tone = (m: UrlMsg) =>
    m.tone === "refused" || m.tone === "ok" ? "bg-okbg text-ok" : m.tone === "notx402" ? "bg-warnbg text-warn" : "bg-badbg text-bad";

  return (
    <Card>
      <CardHead title="Buy from any URL" hint="Paste a website link; the agent tries an x402 purchase at it." />
      <div className="space-y-2.5 p-5">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void buy();
          }}
          placeholder="https://example.com/buy?item=1"
          disabled={busy || !canPay}
          title={canPay ? undefined : "Set CUSTOMER_ACCOUNT_ID and CUSTOMER_PRIVATE_KEY in .env"}
          className="mono w-full rounded-xl border border-line bg-surface2 px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent disabled:opacity-60"
          aria-label="Website link to buy from"
        />
        <button
          onClick={buy}
          disabled={busy || !canPay || !url.trim()}
          title={canPay ? undefined : "Set CUSTOMER_ACCOUNT_ID and CUSTOMER_PRIVATE_KEY in .env"}
          className="flex w-full items-center justify-between rounded-full border border-accent/50 bg-surface px-4 py-3 text-left font-medium transition-colors hover:border-accent disabled:opacity-60"
        >
          <span>
            Send the agent
            <span className="block text-xs font-normal text-muted">It pays only a verified Sangam merchant, at its registered domain</span>
          </span>
          {busy ? <Spinner className="h-4 w-4" /> : <span aria-hidden className="text-muted">→</span>}
        </button>
        {msg && (
          <p className={`rounded-lg p-3 text-xs ${tone(msg)}`} role="status">
            {msg.text}
            {msg.href && (
              <>
                {" · "}
                <a className="text-accent underline-offset-2 hover:underline" href={msg.href} target="_blank" rel="noreferrer">
                  HashScan ↗
                </a>
              </>
            )}
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-muted">
          The agent refuses (and signs nothing) when the site doesn&apos;t answer with an x402 invoice, when the invoice names
          anything but a verified <span className="mono">*.sangam.eth</span> merchant at the ENS price, or when the page doesn&apos;t
          live on that merchant&apos;s registered domain.
        </p>
      </div>
    </Card>
  );
}
