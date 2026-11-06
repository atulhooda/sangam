"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHead, Spinner } from "../components/ui";
import { AgentRunOverlay, runPayAsAgent, useAgentRun } from "../components/agent-run";
import { WavRecorder } from "../../lib/wav";
import { rupees } from "../dashboard/format";

/*
 * Bolo Sangam, buyer side: the buyer speaks instead of clicking.
 *
 *   "kitna dena hai?"   → the invoice is read back aloud (Bulbul, Hindi)
 *   "bhar do"           → the buyer agent pays the pasted invoice link over
 *                         x402 (ENS checks, budget, rails — the usual path),
 *                         and Bulbul confirms
 *
 * The agent only pays after the same trust checks as any other purchase:
 * voice is the interface, never the authority.
 */

type Phase = "idle" | "recording" | "thinking" | "paying" | "done";

type Status = { id: string; merchant: string; buyer: string; amountPaise: number; status: string; hcsSequence: number | null };

type Reply = { transcript: string; parsed: { intent?: string; confirm?: boolean } };

const invoiceIdOf = (url: string): string | null => {
  const m = url.match(/bolo\/invoice\/([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
};

export function BoloBuyer() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<WavRecorder | null>(null);
  const agentRun = useAgentRun();

  useEffect(() => {
    fetch("/api/bolo/config", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ enabled?: boolean }>)
      .then((c) => setEnabled(Boolean(c.enabled)))
      .catch(() => setEnabled(false));
  }, []);

  const say = useCallback((text: string) => {
    fetch("/api/bolo/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) })
      .then(async (r) => (r.ok ? ((await r.json()) as { audio: string }).audio : null))
      .then((b64) => {
        if (!b64) return;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        void new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }))).play().catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);

  const loadStatus = useCallback(async () => {
    const id = invoiceIdOf(url.trim());
    if (!id) return null;
    const res = await fetch(`/api/bolo/invoice/${id}/status`, { cache: "no-store" });
    if (!res.ok) return null;
    const s = (await res.json()) as Status;
    setStatus(s);
    return s;
  }, [url]);

  const onVoice = useCallback(
    async (audio: Blob) => {
      setPhase("thinking");
      try {
        const form = new FormData();
        form.set("audio", audio, "speech.wav");
        form.set("role", "buyer");
        const res = await fetch("/api/bolo/voice", { method: "POST", body: form });
        const body = (await res.json().catch(() => ({}))) as Reply & { error?: string };
        if (!res.ok || !body.transcript) throw new Error(body.error ?? `voice parse failed (${res.status})`);
        const intent = body.parsed.intent ?? "unknown";
        if (intent === "amount" || intent === "status") {
          const s = await loadStatus();
          if (!s) {
            say("Ye invoice nahi mila. Link check kijiye.");
            setError("Paste a Bolo invoice link first.");
          } else if (s.status === "paid") {
            say("Ye invoice bhara ja chuka hai. Dhanyavaad.");
          } else {
            say(`Aapko ${s.buyer} ko ${Math.round(s.amountPaise / 100)} rupaye dene hain.`);
          }
          setPhase("idle");
          return;
        }
        if (intent === "pay") {
          const link = url.trim();
          if (!invoiceIdOf(link) && !/^https?:\/\//i.test(link)) {
            say("Pehle invoice ka link paste kijiye.");
            setError("Paste the invoice's x402 pay link first.");
            setPhase("idle");
            return;
          }
          await pay(link);
          return;
        }
        say("Samajh nahi aaya. Bhar do, ya kitna dena hai — boliye.");
        setPhase("idle");
      } catch (err) {
        setError((err as Error).message);
        setPhase("idle");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, loadStatus, say],
  );

  const pay = useCallback(
    async (link: string) => {
      setPhase("paying");
      const { verdict, body } = await runPayAsAgent(
        agentRun.run,
        { title: "Bolo pay", target: new URL(link, window.location.origin).host },
        { kind: "url", url: link },
        "/api/pay",
      );
      if (verdict.kind === "paid") {
        say("Bhar gaya. Rasid consensus par hai.");
        setPhase("done");
        void loadStatus();
      } else {
        const message = verdict.kind === "refused" ? "Agent ne bhara hi nahi — invoice bharosa mandit nahi tha." : "Payment nahi hui.";
        say(message);
        setError(verdict.kind === "error" ? verdict.message : message);
        setPhase("idle");
        void body;
      }
    },
    [agentRun, loadStatus, say],
  );

  const listen = useCallback(async () => {
    setError(null);
    if (phase === "recording") {
      const audio = await recorder.current?.stop().catch(() => null);
      recorder.current = null;
      if (!audio) {
        setError("Kuch sunayi nahi diya.");
        setPhase("idle");
        return;
      }
      await onVoice(audio);
      return;
    }
    try {
      recorder.current = recorder.current ?? new WavRecorder();
      await recorder.current.start();
      setPhase("recording");
    } catch {
      setError("Mic permission chahiye — browser se allow kijiye.");
    }
  }, [phase, onVoice]);

  if (enabled === null || !enabled) return null;

  return (
    <>
      <Card>
        <CardHead title="Bolo pay — invoices by voice" hint="Invoice ka link paste kijiye, phir boliye: “kitna dena hai?” ya “bhar do”." />
        <div className="flex flex-col gap-3 px-5 py-5">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/api/bolo/invoice/…"
            className="mono w-full rounded-full border border-line bg-surface2 px-4 py-2.5 text-xs text-ink outline-none transition-colors focus:border-accent"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => void listen()}
              disabled={phase === "thinking" || phase === "paying"}
              aria-label={phase === "recording" ? "Stop and listen" : "Speak"}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl text-white transition-all ${
                phase === "recording" ? "bg-bad" : "bg-accent hover:opacity-90"
              } disabled:opacity-50`}
            >
              {phase === "thinking" || phase === "paying" ? <Spinner /> : phase === "recording" ? "■" : "🎤"}
            </button>
            <p className="text-sm text-muted">
              {phase === "idle" && "Mic dabaiye aur boliye"}
              {phase === "recording" && <span className="text-bad">सुन रहा हूँ… click to stop</span>}
              {phase === "thinking" && "Sarvam sun raha hai…"}
              {phase === "paying" && "Agent pay kar raha hai…"}
              {phase === "done" && "Bhara gaya ✓"}
            </p>
          </div>
          {status && (
            <p className="rounded-xl bg-surface2 px-4 py-3 text-sm">
              {status.buyer} · {rupees(status.amountPaise)} ·{" "}
              <span className={status.status === "paid" ? "text-ok" : "text-warn"}>{status.status === "paid" ? "paid" : "unpaid"}</span>
            </p>
          )}
          {error && <p className="text-sm text-bad">{error}</p>}
        </div>
      </Card>
      <AgentRunOverlay state={agentRun.state} onClose={agentRun.close} />
    </>
  );
}
