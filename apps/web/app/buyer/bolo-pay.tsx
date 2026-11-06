"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHead, Spinner } from "../components/ui";
import { AgentRunOverlay, runPayAsAgent, useAgentRun } from "../components/agent-run";
import { BoloVoice, type Caption, type VoicePhase } from "../../lib/bolo-voice";

/*
 * Bolo Sangam, buyer side: a live Hindi conversation about the invoice.
 *
 *   "kitna dena hai?"  → Bolo reads the invoice aloud
 *   "bhar do" → "haan" → the voice session ends with a pay intent, and the
 *   buyer's OWN browser (this component) runs the agent — payment authority
 *   never leaves the buyer's session, ENS checks included.
 */

type Phase = "idle" | VoicePhase | "paying";

type SessionResult = { id: string; status: string; intent: "pay" | null };

export function BoloBuyer() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const voice = useRef<BoloVoice | null>(null);
  const agentRun = useAgentRun();

  useEffect(() => {
    fetch("/api/bolo/config", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ voiceEnabled?: boolean }>)
      .then((c) => setEnabled(Boolean(c.voiceEnabled)))
      .catch(() => setEnabled(false));
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setCaptions([]);
    const link = url.trim();
    try {
      const created = (await (
        await fetch("/api/bolo/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "buyer", invoiceUrl: link || undefined }),
        })
      ).json()) as { session_id: string; ws_url: string; token: string; error?: string };
      if (created.error || !created.ws_url) throw new Error(created.error ?? "session refused");
      voice.current = new BoloVoice(created.ws_url, created.token, {
        onPhase: (p) => {
          setPhase(p);
          if (p === "ended") void maybePay(created.session_id);
        },
        onCaption: (c) => setCaptions((prev) => [...prev.slice(-6), c]),
      });
      await voice.current.start();
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const maybePay = useCallback(
    async (sessionId: string) => {
      setPhase("paying");
      let result: SessionResult | null = null;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const s = (await (await fetch(`/api/bolo/session/${sessionId}`, { cache: "no-store" })).json()) as SessionResult;
          if (s.status !== "open") {
            result = s;
            break;
          }
        } catch {
          /* callback may still be in flight */
        }
      }
      if (result?.intent !== "pay") {
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
        setError(verdict.kind === "refused" ? "Agent ne mana kar diya — invoice bharosa mandit nahi tha." : verdict.kind === "error" ? verdict.message : "Payment nahi hui.");
      }
      setPhase("idle");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url],
  );

  const hangUp = useCallback(() => voice.current?.stop(), []);

  if (enabled === null || !enabled) return null;

  const inCall = phase !== "idle" && phase !== "ended" && phase !== "error" && phase !== "paying";
  const speaking = phase === "bolo";
  const label =
    phase === "idle" ? "Paste the invoice link, then talk" :
    phase === "connecting" ? "Connecting…" :
    speaking ? "बोलो बोल रही है…" :
    phase === "listening" ? "सुन रही हूँ — boliye" :
    phase === "thinking" ? "सोच रही हूँ…" :
    phase === "paying" ? "Agent पे कर रहा है…" :
    phase === "ended" ? "Session खत्म" :
    phase === "error" ? "Connection टूटा" : phase;

  return (
    <>
      <Card>
        <CardHead title="Bolo pay — live voice" hint="Invoice ka link paste kijiye, session shuru kijiye, phir boliye: “kitna dena hai?” ya “bhar do”." />
        <div className="flex flex-col gap-3 px-5 py-5">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/api/bolo/invoice/…"
            className="mono w-full rounded-full border border-line bg-surface2 px-4 py-2.5 text-xs text-ink outline-none transition-colors focus:border-accent"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => (inCall ? hangUp() : void start())}
              disabled={phase === "connecting" || phase === "paying"}
              aria-label={inCall ? "Hang up" : "Start voice session"}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl text-white transition-all ${
                phase === "paying" ? "bg-warn" : inCall ? (speaking ? "bg-warn" : "bg-accent") : "bg-accent hover:opacity-90"
              } disabled:opacity-50`}
            >
              {phase === "paying" ? <Spinner /> : inCall ? "■" : "📞"}
            </button>
            <p className={`text-sm ${speaking ? "text-warn" : "text-muted"}`}>{label}</p>
          </div>

          {captions.length > 0 && (
            <div className="space-y-1.5">
              {captions.map((c, i) => (
                <p key={i} className={`rounded-xl px-4 py-2.5 text-sm ${c.role === "bolo" ? "bg-surface2 text-ink" : "bg-okbg text-ok"}`}>
                  {c.role === "bolo" ? "🎙 " : "🗣 "}{c.text}
                </p>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-bad">{error}</p>}
        </div>
      </Card>
      <AgentRunOverlay state={agentRun.state} onClose={agentRun.close} />
    </>
  );
}
