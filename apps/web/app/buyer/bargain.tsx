"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "../components/ui";
import { AgentRunOverlay, runPayAsAgent, useAgentRun } from "../components/agent-run";
import { rupees } from "../dashboard/format";
import { BargainArena, OgComputeBadge, type OgInfo } from "./bargain-arena";

/*
 * Agent-to-agent bargaining, as the buyer sees it. Click "Bargain" on a
 * merchant → POST /api/bargain runs the haggle (0G, or the deterministic
 * fallback) within the merchant's ENS margin → the offers stream in as chat
 * bubbles, the price ticker slides from the list price to the deal, and the
 * buyer pays the agreed (discounted) price through the normal pipeline.
 */

type Turn = { by: "buyer" | "merchant"; offerPaise: number; message: string; via?: "0g" | "local" };
type BargainResult = {
  listPaise: number;
  askPaise: number;
  floorPaise: number;
  agreedPaise: number;
  savedPaise: number;
  savedBps: number;
  vsListPaise: number;
  bargainBps: number;
  usedModel: boolean;
  ogTurns?: number;
  og?: OgInfo;
  rounds: Turn[];
  payUrl: string;
};
type Phase = "negotiating" | "dealt" | "paying" | "paid" | "error";

export function BargainButton({ ensName, disabled, onDone }: { ensName: string; disabled?: boolean; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("negotiating");
  const [data, setData] = useState<BargainResult | null>(null);
  const [shown, setShown] = useState(0); // how many rounds revealed
  const [error, setError] = useState<string | null>(null);
  const agentRun = useAgentRun();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => () => clearTimers(), []);

  const start = useCallback(async () => {
    setOpen(true);
    setPhase("negotiating");
    setData(null);
    setShown(1); // the merchant's opening quote shows immediately
    setError(null);
    clearTimers();
    try {
      const res = await fetch("/api/bargain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ensName }),
      });
      const body = (await res.json()) as BargainResult & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `Bargain failed (${res.status})`);
      setData(body);
      // reveal the remaining rounds one at a time
      for (let i = 2; i <= body.rounds.length; i++) {
        timers.current.push(setTimeout(() => setShown(i), (i - 1) * 850));
      }
      timers.current.push(setTimeout(() => setPhase("dealt"), body.rounds.length * 850 + 250));
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }, [ensName]);

  const pay = useCallback(async () => {
    if (!data) return;
    setPhase("paying");
    const { verdict } = await runPayAsAgent(
      agentRun.run,
      { title: "Paying the bargained price", target: ensName },
      { kind: "url", url: data.payUrl },
      "/api/pay",
    );
    if (verdict.kind === "paid") {
      setPhase("paid");
      onDone?.();
    } else {
      setError(verdict.kind === "refused" ? verdict.message : verdict.kind === "error" ? verdict.message : "Payment nahi hui.");
      setPhase("error");
    }
  }, [data, ensName, agentRun.run, onDone]);

  const close = () => {
    clearTimers();
    setOpen(false);
  };

  return (
    <>
      <button
        onClick={() => void start()}
        disabled={disabled}
        className="rounded-full border border-accent/50 bg-accentbg/40 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:border-accent disabled:opacity-50"
      >
        ⚖︎ Bargain
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center" onClick={close}>
          <div
            className="w-full max-w-md overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <p className="mono text-sm font-semibold text-accent">{ensName}</p>
                <p className="text-xs text-muted">
                  {phase === "negotiating" ? "Agents bargaining…" : phase === "dealt" ? "Deal struck" : phase === "paying" ? "Paying as your agent…" : phase === "paid" ? "Paid ✓" : "Bargaining"}
                </p>
              </div>
              <button onClick={close} aria-label="Close" className="rounded-full p-1 text-muted transition-colors hover:text-ink">✕</button>
            </div>

            {/* tug-of-war arena */}
            <div className="px-5 py-4">
              {data ? (
                <BargainArena data={data} shown={shown} done={phase === "dealt" || phase === "paying" || phase === "paid"} og={data.og} />
              ) : (
                <div className="space-y-3 py-4">
                  <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted"><Spinner /> Agents are sizing each other up…</p>
                  <OgComputeBadge data={null} done={false} />
                </div>
              )}
              {error && <p className="mt-3 rounded-xl bg-badbg px-3 py-2 text-sm text-bad">{error}</p>}
            </div>

            {/* actions */}
            <div className="border-t border-line px-5 py-4">
              {phase === "dealt" && data && (
                <button onClick={() => void pay()} className="w-full rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:text-[#0b0d1a]">
                  Pay {rupees(data.agreedPaise)} as agent →
                </button>
              )}
              {phase === "paying" && <p className="flex items-center justify-center gap-2 text-sm text-muted"><Spinner /> Signing USDC on Hedera…</p>}
              {phase === "paid" && <p className="text-center text-sm font-medium text-ok">Paid {data && rupees(data.agreedPaise)} — settlement is running below. 🎉</p>}
              {phase === "error" && <button onClick={() => void start()} className="w-full rounded-full border border-line px-5 py-2.5 text-sm font-medium transition-colors hover:border-accent">Try again</button>}
              {phase === "negotiating" && <p className="text-center text-xs text-muted">The merchant's agent opens at list + margin and the deal always lands inside its published ± band on ENS.</p>}
            </div>
          </div>
        </div>
      )}

      <AgentRunOverlay state={agentRun.state} onClose={agentRun.close} />
    </>
  );
}
