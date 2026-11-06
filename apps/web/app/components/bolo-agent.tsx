"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { BoloVoice, type Caption, type VoicePhase } from "../../lib/bolo-voice";
import { AgentRunOverlay, runPayAsAgent, useAgentRun } from "./agent-run";
import type { RobotState } from "./bolo-robot";

/*
 * The floating Bolo agent: a little robot that lives over the whole desk
 * instead of inside a card. Tap it → mic → a live Hindi voice session starts
 * and it speaks. A panel slides out with captions, the invoice link (buyer)
 * and results. Same BoloVoice transport and same pay/invoice flow as before —
 * only the presentation changed.
 */

const BoloRobot = dynamic(() => import("./bolo-robot"), {
  ssr: false,
  loading: () => <div style={{ width: 150, height: 150 }} />,
});

type Phase = "idle" | VoicePhase | "working";
type BuyerResult = { id: string; status: string; intent: "pay" | null };
type MerchantResult = { id: string; status: string; invoiceId: string | null; payUrl: string | null };

export function BoloAgent({ role, name }: { role: "buyer" | "merchant"; name?: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<MerchantResult | null>(null);
  const voice = useRef<BoloVoice | null>(null);
  const agentRun = useAgentRun();

  useEffect(() => {
    fetch("/api/bolo/config", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ voiceEnabled?: boolean }>)
      .then((c) => setEnabled(Boolean(c.voiceEnabled)))
      .catch(() => setEnabled(false));
  }, []);

  const pollSession = useCallback(async <T,>(sessionId: string, tries = 15): Promise<T | null> => {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const s = (await (await fetch(`/api/bolo/session/${sessionId}`, { cache: "no-store" })).json()) as { status?: string } & T;
        if (s.status && s.status !== "open") return s;
      } catch {
        /* callback may still be in flight */
      }
    }
    return null;
  }, []);

  const buyerPay = useCallback(
    async (sessionId: string) => {
      setPhase("working");
      const s = await pollSession<BuyerResult>(sessionId);
      if (s?.intent !== "pay") {
        setPhase("idle");
        return;
      }
      const link = url.trim();
      if (!/^https?:\/\//i.test(link)) {
        setError("Bolo said pay, but there's no invoice link pasted.");
        setPhase("idle");
        return;
      }
      const { verdict } = await runPayAsAgent(
        agentRun.run,
        { title: "Bolo pay", target: new URL(link, window.location.origin).host },
        { kind: "url", url: link },
        "/api/pay",
      );
      if (verdict.kind !== "paid") {
        setError(
          verdict.kind === "refused"
            ? "Agent ne mana kar diya — invoice bharosa mandit nahi tha."
            : verdict.kind === "error"
              ? verdict.message
              : "Payment nahi hui.",
        );
      }
      setPhase("idle");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, pollSession],
  );

  const merchantFinish = useCallback(
    async (sessionId: string) => {
      setPhase("working");
      const s = await pollSession<MerchantResult>(sessionId);
      if (s) setResult(s);
      setPhase("idle");
    },
    [pollSession],
  );

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    setCaptions([]);
    setOpen(true);
    try {
      const body = role === "buyer" ? { role, invoiceUrl: url.trim() || undefined } : { role };
      const created = (await (
        await fetch("/api/bolo/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json()) as { session_id: string; ws_url: string; token: string; error?: string };
      if (created.error || !created.ws_url) throw new Error(created.error ?? "session refused");
      voice.current = new BoloVoice(created.ws_url, created.token, {
        onPhase: (p) => {
          setPhase(p);
          if (p === "ended") void (role === "buyer" ? buyerPay(created.session_id) : merchantFinish(created.session_id));
        },
        onCaption: (c) => setCaptions((prev) => [...prev.slice(-6), c]),
      });
      await voice.current.start();
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
    }
  }, [role, url, buyerPay, merchantFinish]);

  const hangUp = useCallback(() => voice.current?.stop(), []);

  if (enabled === null || !enabled) return null;

  const inCall = phase !== "idle" && phase !== "ended" && phase !== "error" && phase !== "working";
  const speaking = phase === "bolo";
  const robotState: RobotState =
    phase === "bolo" ? "speaking"
      : phase === "listening" ? "listening"
      : phase === "thinking" ? "thinking"
      : phase === "connecting" ? "connecting"
      : phase === "working" ? "working"
      : phase === "ended" ? "ended"
      : phase === "error" ? "error"
      : "idle";

  const label =
    phase === "idle" ? (role === "buyer" ? "Namaste — tap karke boliye" : "Namaste — invoice banane ke liye boliye")
      : phase === "connecting" ? "Connecting…"
      : speaking ? "बोलो बोल रही है…"
      : phase === "listening" ? "सुन रही हूँ — boliye"
      : phase === "thinking" ? "सोच रही हूँ…"
      : phase === "working" ? (role === "buyer" ? "Agent पे कर रहा है…" : "इनवॉइस बन रहा है…")
      : phase === "ended" ? "Session खत्म"
      : "Connection टूटा";

  const tapRobot = () => {
    if (inCall) hangUp();
    else void start();
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
        {/* ── slide-out panel ── */}
        <div
          className={`w-[min(20rem,calc(100vw-2rem))] origin-bottom-right overflow-hidden rounded-3xl border border-line bg-surface/95 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
            open ? "max-h-[70vh] translate-y-0 opacity-100" : "pointer-events-none max-h-0 translate-y-3 opacity-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${inCall ? (speaking ? "bg-warn" : "bg-ok") : "bg-muted"}`} />
                {inCall && <span className={`absolute inset-0 animate-ping rounded-full ${speaking ? "bg-warn/60" : "bg-ok/60"}`} />}
              </span>
              <p className="text-sm font-semibold">
                बोलो <span className="font-normal text-muted">· {role === "buyer" ? "pay by voice" : "voice invoices"}</span>
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Collapse" className="rounded-full p-1 text-muted transition-colors hover:text-ink">
              ✕
            </button>
          </div>

          <div className="max-h-[calc(70vh-3rem)] space-y-3 overflow-y-auto px-4 py-3">
            {role === "buyer" && (
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/api/bolo/invoice/…"
                className="mono w-full rounded-full border border-line bg-surface2 px-4 py-2.5 text-xs text-ink outline-none transition-colors focus:border-accent"
              />
            )}

            <p className={`text-sm ${speaking ? "text-warn" : "text-muted"}`}>{label}</p>

            {captions.length > 0 && (
              <div className="space-y-1.5">
                {captions.map((c, i) => (
                  <p key={i} className={`rounded-2xl px-3.5 py-2 text-sm ${c.role === "bolo" ? "bg-surface2 text-ink" : "bg-okbg text-ok"}`}>
                    {c.role === "bolo" ? "🎙 " : "🗣 "}
                    {c.text}
                  </p>
                ))}
              </div>
            )}

            {error && <p className="rounded-xl bg-badbg px-3 py-2 text-sm text-bad">{error}</p>}

            {result?.status === "completed" && result.payUrl && (
              <div className="space-y-1 rounded-2xl bg-okbg px-3.5 py-3 text-center">
                <p className="text-sm font-medium text-ok">इनवॉइस बन गया ✓</p>
                <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={result.payUrl} target="_blank" rel="noreferrer">
                  {result.payUrl.replace(/^https?:\/\//, "").slice(0, 60)}… ↗
                </a>
              </div>
            )}
            {result?.status === "completed" && !result.payUrl && <p className="text-sm text-muted">Session पूरा हुआ, पर invoice नहीं बना — फिर से बोलिए।</p>}

            {inCall && (
              <button
                onClick={hangUp}
                className="w-full rounded-full border border-bad/40 bg-badbg/60 px-4 py-2 text-sm font-medium text-bad transition-colors hover:border-bad"
              >
                ■ Hang up
              </button>
            )}
            {!inCall && role === "buyer" && (
              <p className="text-[11px] text-muted">
                Tip: invoice link paste kijiye, phir robot ko tap karke boliye “kitna dena hai?” ya “bhar do”.
              </p>
            )}
          </div>
        </div>

        {/* ── the robot ── */}
        <div className="flex flex-col items-center">
          <button
            onClick={tapRobot}
            onDoubleClick={() => setOpen((o) => !o)}
            aria-label={inCall ? "Hang up voice session" : "Start Bolo voice session"}
            title={inCall ? "Tap to hang up · double-tap to toggle panel" : "Tap to talk · double-tap to open"}
            className="group relative grid place-items-center rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span
              className={`pointer-events-none absolute inset-2 rounded-full blur-xl transition-opacity ${
                speaking ? "bg-warn/40 opacity-100" : inCall ? "bg-ok/30 opacity-100" : "bg-accent/30 opacity-70 group-hover:opacity-100"
              }`}
            />
            <BoloRobot state={robotState} getLevels={() => voice.current?.levels() ?? { bolo: 0, mic: 0 }} size={150} />
          </button>
          {!open && (
            <button
              onClick={() => setOpen(true)}
              className="mono -mt-1 rounded-full border border-line bg-surface/90 px-3 py-1 text-[11px] text-muted shadow backdrop-blur transition-colors hover:border-accent hover:text-ink"
            >
              {inCall ? "बोलो live ·" : "बोलो"} {role === "buyer" ? "pay by voice" : "voice invoice"}
            </button>
          )}
        </div>
      </div>

      <AgentRunOverlay state={agentRun.state} onClose={agentRun.close} />
    </>
  );
}
