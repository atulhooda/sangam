"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHead, Spinner } from "../../components/ui";
import { WavRecorder } from "../../../lib/wav";
import { rupees } from "../../dashboard/format";

/*
 * Bolo Sangam — the merchant speaks an invoice:
 *
 *   "Ramesh ke liye 2500 ka invoice, saat din"
 *     → Saaras v4 transcript (codemix: Hinglish as spoken)
 *     → Sarvam-105B parse → { buyer, ₹2500, due 7d }
 *     → the merchant confirms (click, or "haan" — spoken)
 *     → HCS consensus pins the invoice
 *     → Bulbul answers: "invoice ban gaya" + the x402 pay link
 *
 * Nothing irreversible happens on a mishearing: the confirm step shows the
 * transcript and the parsed fields, and amounts that fail to parse never
 * leave the confirm card.
 */

type Phase = "idle" | "recording" | "thinking" | "confirm" | "publishing" | "done";

type Draft = { buyerName: string | null; amountInr: number | null; dueDays: number | null; note: string | null; confirm: boolean };

type Published = { id: string; payUrl: string; hcsSequence: number | null };

type ParsedReply = { transcript: string; parsed: Draft & { intent?: string } };

const EXAMPLE = 'उदाहरण: "रमेश के लिए 2500 का इनवॉइस, सात दिन"';

export function BoloPanel({ name }: { name: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [published, setPublished] = useState<Published | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<WavRecorder | null>(null);
  const [micHint, setMicHint] = useState(false);

  useEffect(() => {
    fetch("/api/bolo/config", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ enabled?: boolean }>)
      .then((c) => setEnabled(Boolean(c.enabled)))
      .catch(() => setEnabled(false));
  }, []);

  /** Bulbul speaks a line back (fire-and-forget: a TTS failure is cosmetic). */
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

  const submit = useCallback(
    async (audio: Blob, role: "merchant" | "buyer") => {
      const form = new FormData();
      form.set("audio", audio, "speech.wav");
      form.set("role", role);
      const res = await fetch("/api/bolo/voice", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as ParsedReply & { error?: string };
      if (!res.ok || !body.transcript) throw new Error(body.error ?? `voice parse failed (${res.status})`);
      return body;
    },
    [],
  );

  const publish = useCallback(
    async (d: Draft, said: string) => {
      if (!d.buyerName || !d.amountInr) {
        setError("Jitna suna usmein naam ya rakam missing hai — dobara boliye.");
        setPhase("idle");
        return;
      }
      setPhase("publishing");
      setError(null);
      try {
        const res = await fetch("/api/bolo/invoice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transcript: said, buyerName: d.buyerName, amountPaise: d.amountInr * 100, dueDays: d.dueDays, note: d.note }),
        });
        const body = (await res.json().catch(() => ({}))) as Published & { error?: string };
        if (!res.ok || !body.payUrl) throw new Error(body.error ?? `invoice publish failed (${res.status})`);
        setPublished({ id: body.id, payUrl: body.payUrl, hcsSequence: body.hcsSequence ?? null });
        setPhase("done");
        say(`Invoice ban gaya. ${d.buyerName} ke liye, ${d.amountInr} rupaye.`);
      } catch (err) {
        setError((err as Error).message);
        setPhase("confirm");
      }
    },
    [say],
  );

  /** Click while idle/confirm: start listening. Click while recording: stop, transcribe, act. */
  const listen = useCallback(async () => {
    setError(null);
    if (phase === "recording") {
      setPhase("thinking");
      const audio = await recorder.current?.stop().catch(() => null);
      recorder.current = null;
      if (!audio) {
        setError("Kuch sunayi nahi diya — mic ke paas boliye.");
        setPhase("idle");
        return;
      }
      try {
        const { transcript, parsed } = await submit(audio, "merchant");
        setTranscript(transcript);
        // In the confirm phase, a spoken "haan" publishes the standing draft.
        if (draft && parsed.confirm) {
          await publish(draft, transcript);
          return;
        }
        setDraft(parsed);
        setPhase(parsed.buyerName && parsed.amountInr ? "confirm" : "idle");
        if (!(parsed.buyerName && parsed.amountInr)) setError("Naam ya rakam samajh nahi aaya — phir boliye, ya neeche type kijiye.");
      } catch (err) {
        setError((err as Error).message);
        setPhase("idle");
      }
      return;
    }
    // Start recording (from idle or confirm).
    try {
      recorder.current = recorder.current ?? new WavRecorder();
      await recorder.current.start();
      setMicHint(false);
      setPublished(null);
      setPhase("recording");
    } catch {
      setMicHint(true);
      setError("Mic permission chahiye — browser se allow kijiye.");
    }
  }, [phase, draft, publish, submit]);

  if (enabled === null) {
    return (
      <Card>
        <CardHead title="Bolo Sangam" hint="Invoices by voice, in Hindi." />
        <p className="flex items-center gap-2 px-5 pb-5 text-sm text-muted">
          <Spinner /> Loading voice…
        </p>
      </Card>
    );
  }
  if (!enabled) return null;

  const busy = phase === "thinking" || phase === "publishing";
  const recording = phase === "recording";

  return (
    <Card>
      <CardHead
        title="Bolo Sangam — invoices by voice"
        hint="Hindi ya Hinglish mein boliye. Confirm karne ke baad hi invoice banta hai."
      />
      <div className="flex flex-col items-center gap-4 px-5 py-6">
        <button
          onClick={() => void listen()}
          disabled={busy}
          aria-label={recording ? "Stop and transcribe" : "Speak an invoice"}
          className={`relative flex h-20 w-20 items-center justify-center rounded-full text-3xl transition-all ${
            recording ? "bg-bad text-white" : "bg-accent text-white hover:opacity-90"
          } disabled:opacity-50`}
        >
          {recording && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-bad/40" />}
          {busy ? <Spinner /> : recording ? "■" : "🎤"}
        </button>
        <p className="text-center text-sm text-muted">
          {phase === "idle" && <>Mic dabaiye aur boliye — <span className="text-ink">{EXAMPLE}</span></>}
          {recording && <span className="text-bad">सुन रहा हूँ… click to stop</span>}
          {phase === "thinking" && "Sarvam sun raha hai…"}
          {phase === "confirm" && "Theek hai? Confirm kijiye — ya boliye “haan”."}
          {phase === "publishing" && "HCS par publish ho raha hai…"}
          {phase === "done" && "Ho gaya. Pay link neeche hai."}
        </p>

        {transcript && phase !== "idle" && (
          <p className="w-full rounded-xl bg-surface2 px-4 py-3 text-sm italic text-muted">“{transcript}”</p>
        )}

        {draft && (phase === "confirm" || phase === "publishing" || phase === "done") && (
          <div className="grid w-full grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-surface2 px-3 py-3">
              <p className="text-[11px] uppercase tracking-wider text-muted">Kis ke liye</p>
              <p className="mt-1 truncate font-medium">{draft.buyerName ?? "—"}</p>
            </div>
            <div className="rounded-xl bg-surface2 px-3 py-3">
              <p className="text-[11px] uppercase tracking-wider text-muted">Rakam</p>
              <p className="mt-1 font-medium">{draft.amountInr ? rupees(draft.amountInr * 100) : "—"}</p>
            </div>
            <div className="rounded-xl bg-surface2 px-3 py-3">
              <p className="text-[11px] uppercase tracking-wider text-muted">Due</p>
              <p className="mt-1 font-medium">{draft.dueDays ? `${draft.dueDays} din` : "—"}</p>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-bad">{error}</p>}

        {phase === "confirm" && draft && (
          <div className="flex gap-3">
            <button
              onClick={() => void publish(draft, transcript ?? "")}
              className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Haan, ban gaya ✓
            </button>
            <button
              onClick={() => {
                setDraft(null);
                setTranscript(null);
                setPhase("idle");
              }}
              className="rounded-full border border-line px-5 py-2 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
            >
              Dobara boliye
            </button>
          </div>
        )}

        {phase === "done" && published && (
          <div className="w-full space-y-2 text-center">
            <p className="text-sm">
              <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={published.payUrl} target="_blank" rel="noreferrer">
                {published.payUrl.replace(/^https?:\/\//, "").slice(0, 64)}… ↗
              </a>
            </p>
            <p className="text-xs text-muted">
              x402 pay link · {published.hcsSequence ? `receipt #${published.hcsSequence} on HCS` : "HCS publish pending"} · buyer agent ise abhi bhar sakta hai
            </p>
          </div>
        )}

        {micHint && <p className="text-xs text-warn">Tip: mic sirf https ya localhost par chalta hai.</p>}
      </div>
      <p className="px-5 pb-4 text-[11px] text-muted">
        Merchant {name} · Saaras STT + Sarvam-105B parse + Bulbul voice · invoice pinned to HCS consensus
      </p>
    </Card>
  );
}
