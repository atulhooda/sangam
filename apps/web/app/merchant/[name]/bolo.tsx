"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHead, Spinner } from "../../components/ui";
import { BoloVoice, type Caption, type VoicePhase } from "../../../lib/bolo-voice";
import { rupees } from "../../dashboard/format";

/*
 * Bolo Sangam, merchant side: a live Hindi conversation, Ritu-style.
 *
 *   Start session → the browser streams mic audio straight to the voice
 *   server (this app never touches audio) → Bolo asks "kis ke liye, kitne
 *   ka?", parses the answer, reads the draft back, waits for "haan" → the
 *   signed callback creates the real invoice here, pinned to HCS, with its
 *   x402 pay link.
 *
 * Phases and captions mirror OncoReady's Talk-to-Ritu UI.
 */

type Phase = "idle" | VoicePhase | "finishing";

type SessionResult = { id: string; status: string; invoiceId: string | null; payUrl: string | null };

export function BoloPanel({ name }: { name: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const voice = useRef<BoloVoice | null>(null);

  useEffect(() => {
    fetch("/api/bolo/config", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ voiceEnabled?: boolean }>)
      .then((c) => setEnabled(Boolean(c.voiceEnabled)))
      .catch(() => setEnabled(false));
  }, []);

  const pollResult = useCallback(async (sessionId: string, tries = 15): Promise<SessionResult | null> => {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const s = (await (await fetch(`/api/bolo/session/${sessionId}`, { cache: "no-store" })).json()) as SessionResult;
        if (s.status !== "open") return s;
      } catch {
        /* keep polling; the callback may still be in flight */
      }
    }
    return null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    setCaptions([]);
    try {
      const created = (await (
        await fetch("/api/bolo/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "merchant" }),
        })
      ).json()) as { session_id: string; ws_url: string; token: string; error?: string };
      if (created.error || !created.ws_url) throw new Error(created.error ?? "session refused");
      voice.current = new BoloVoice(created.ws_url, created.token, {
        onPhase: (p) => {
          setPhase(p);
          if (p === "ended") void pollResult(created.session_id).then((s) => s && setResult(s));
        },
        onCaption: (c) => setCaptions((prev) => [...prev.slice(-6), c]),
      });
      await voice.current.start();
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
    }
  }, [pollResult]);

  const hangUp = useCallback(() => voice.current?.stop(), []);

  if (enabled === null) {
    return (
      <Card>
        <CardHead title="Bolo Sangam" hint="Invoices by live voice, in Hindi." />
        <p className="flex items-center gap-2 px-5 pb-5 text-sm text-muted"><Spinner /> Loading voice…</p>
      </Card>
    );
  }
  if (!enabled) return null;

  const inCall = phase !== "idle" && phase !== "ended" && phase !== "error";
  const speaking = phase === "bolo";
  const label =
    phase === "idle" ? "Session shuru kijiye" :
    phase === "connecting" ? "Connecting…" :
    speaking ? "बोलो बोल रही है…" :
    phase === "listening" ? "सुन रही हूँ — boliye" :
    phase === "thinking" ? "सोच रही हूँ…" :
    phase === "finishing" ? "इनवॉइस बन रहा है…" :
    phase === "ended" ? "Session खत्म" :
    phase === "error" ? "Connection टूटा" : phase;

  return (
    <Card>
      <CardHead title="Bolo Sangam — live voice invoices" hint="Ek live Hindi baat-cheet: boliye, Bolo draft padhegi, “haan” par invoice ban jayega." />
      <div className="flex flex-col items-center gap-4 px-5 py-6">
        <button
          onClick={() => (inCall ? hangUp() : void start())}
          disabled={phase === "connecting"}
          aria-label={inCall ? "Hang up" : "Start voice session"}
          className={`relative flex h-20 w-20 items-center justify-center rounded-full text-3xl text-white transition-all ${
            inCall ? (speaking ? "bg-warn" : "bg-accent") : "bg-accent hover:opacity-90"
          } disabled:opacity-50`}
        >
          {inCall && speaking && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-warn/40" />}
          {inCall ? "■" : "📞"}
        </button>
        <p className={`text-center text-sm ${speaking ? "text-warn" : "text-muted"}`}>{label}</p>

        {captions.length > 0 && (
          <div className="w-full space-y-1.5">
            {captions.map((c, i) => (
              <p key={i} className={`rounded-xl px-4 py-2.5 text-sm ${c.role === "bolo" ? "bg-surface2 text-ink" : "bg-okbg text-ok"}`}>
                {c.role === "bolo" ? "🎙 " : "🗣 "}{c.text}
              </p>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-bad">{error}</p>}

        {result?.status === "completed" && result.payUrl && (
          <div className="w-full space-y-2 rounded-xl bg-okbg px-4 py-3 text-center">
            <p className="text-sm font-medium text-ok">इनवॉइस बन गया ✓</p>
            <p className="text-sm">
              <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={result.payUrl} target="_blank" rel="noreferrer">
                {result.payUrl.replace(/^https?:\/\//, "").slice(0, 70)}… ↗
              </a>
            </p>
          </div>
        )}
        {result?.status === "completed" && !result.payUrl && <p className="text-sm text-muted">Session पूरा हुआ, पर invoice नहीं बना — फिर से बोलिए।</p>}
        {result?.status === "failed" && <p className="text-sm text-warn">Session पूरा नहीं हुआ — फिर try kijiye.</p>}
      </div>
      <p className="px-5 pb-4 text-[11px] text-muted">
        Merchant {name} · live mic → Bolo voice server (browser streams directly, app never sees audio) · Saaras STT + Sarvam-105B + Bulbul · confirm par HCS par pinned
      </p>
    </Card>
  );
}
