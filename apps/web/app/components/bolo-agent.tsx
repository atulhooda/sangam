"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { BoloVoice, type Caption, type VoiceAction, type VoicePhase } from "../../lib/bolo-voice";
import { AgentRunOverlay, runPayAsAgent, useAgentRun } from "./agent-run";
import type { RobotState } from "./bolo-robot";

/*
 * The floating Bolo agent: a draggable 3D robot that lives over the whole desk.
 * Tap it → mic → a live Hindi voice session starts and it reacts. Drag the grip
 * to move it anywhere; drag the robot itself to spin it. A panel slides out with
 * captions, the invoice link (buyer) and results. Same BoloVoice transport and
 * same pay / invoice flow as before — only the presentation changed.
 */

const BoloRobot = dynamic(() => import("./bolo-robot"), {
  ssr: false,
  loading: () => <div style={{ width: 160, height: 160 }} />,
});

const SIZE = 160;
type Phase = "idle" | VoicePhase | "working";
type MerchantResult = { id: string; status: string; invoiceId: string | null; payUrl: string | null };
type Pos = { x: number; y: number };
export type BuyTarget = { ensName: string; priceInrPaise?: number };

const DEMO_CYCLE: Phase[] = ["connecting", "bolo", "listening", "thinking", "working", "ended", "error", "idle"];

export function BoloAgent({
  role,
  name,
  demo = false,
  targets,
  rail,
  onDone,
}: {
  role: "buyer" | "merchant";
  name?: string;
  demo?: boolean;
  targets?: BuyTarget[];
  /** Which rail a spoken "yes" pays on — the same one the desk's Buy button uses. */
  rail?: "hedera" | "sepolia";
  onDone?: () => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(demo ? true : null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MerchantResult | null>(null);
  const [target, setTarget] = useState<BuyTarget | null>(null);
  const [bought, setBought] = useState<string | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const voice = useRef<BoloVoice | null>(null);
  const agentRun = useAgentRun();
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  // Live refs the voice-caption closure reads without being re-created.
  const targetsRef = useRef<BuyTarget[]>(targets ?? []);
  targetsRef.current = targets ?? [];
  const targetRef = useRef<BuyTarget | null>(null);
  const railRef = useRef(rail ?? "hedera");
  railRef.current = rail ?? "hedera";
  const buyingRef = useRef(false);

  useEffect(() => {
    if (demo) return;
    fetch("/api/bolo/config", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ voiceEnabled?: boolean }>)
      .then((c) => setEnabled(Boolean(c.voiceEnabled)))
      .catch(() => setEnabled(false));
  }, [demo]);

  // restore / default position
  const clamp = (p: Pos): Pos => ({
    x: Math.max(8, Math.min(window.innerWidth - SIZE - 8, p.x)),
    y: Math.max(8, Math.min(window.innerHeight - SIZE - 44, p.y)),
  });
  useEffect(() => {
    let start: Pos | null = null;
    try {
      const saved = localStorage.getItem(`bolo-pos-${role}`);
      if (saved) start = JSON.parse(saved) as Pos;
    } catch {
      /* ignore */
    }
    setPos(clamp(start ?? { x: window.innerWidth - SIZE - 24, y: window.innerHeight - SIZE - 72 }));
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // drag the grip to move the whole widget
  const onGripDown = (e: React.PointerEvent) => {
    if (!pos) return;
    e.preventDefault();
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos(clamp({ x: ev.clientX - d.dx, y: ev.clientY - d.dy }));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPos((p) => {
        if (p) try { localStorage.setItem(`bolo-pos-${role}`, JSON.stringify(p)); } catch { /* ignore */ }
        return p;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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

  /** Speak a line in Bolo's own (Sarvam) voice; the browser's robotic voice only if that fails. */
  const sayLine = async (text: string) => {
    try {
      const res = await fetch("/api/bolo/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const { audio } = (await res.json()) as { audio?: string };
      if (!audio) throw new Error("no audio");
      await new Audio(`data:audio/wav;base64,${audio}`).play();
    } catch {
      try {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "hi-IN";
        window.speechSynthesis.speak(u);
      } catch {
        /* speech not available */
      }
    }
  };

  // Buy the named merchant as the agent (the /api/agent/buy path: ENS checks,
  // fair-invoice, USDC on Hedera → the usual settlement pipeline).
  const doVoiceBuy = useCallback(
    async (t: BuyTarget, saidByBolo = false) => {
      if (buyingRef.current) return;
      buyingRef.current = true;
      setPhase("working");
      setError(null);
      // A spoken yes: Bolo already said "खरीद रही हूँ" on the call.
      if (!saidByBolo) void sayLine(`ठीक है, ${t.ensName.replace(/\.sangam\.eth$/, "")} से खरीद रही हूँ।`);
      const { verdict } = await runPayAsAgent(agentRun.run, { title: "Buying by voice", target: t.ensName }, { ensName: t.ensName, rail: railRef.current }, "/api/agent/buy");
      if (verdict.kind === "paid") {
        setBought(`${t.ensName} — ho gaya ✓`);
        void sayLine("हो गया! पेमेंट पूरा हुआ।");
        onDone?.();
      } else {
        setError(verdict.kind === "refused" ? verdict.message : verdict.kind === "error" ? verdict.message : "Payment nahi hui.");
      }
      setPhase("idle");
      buyingRef.current = false;
    },
    [agentRun.run, onDone],
  );

  // Bolo runs the conversation on the voice server (it understands the shop
  // name in Hindi, reads the price back in her own voice); the page acts on
  // what she decides: show the shop she picked, and buy it on the buyer's yes.
  const onAction = useCallback(
    (a: VoiceAction) => {
      if (role !== "buyer") return;
      const t = targetsRef.current.find((x) => x.ensName === a.ensName);
      if (!t) return;
      targetRef.current = t;
      setTarget(t);
      setBought(null);
      if (a.action === "buy") void doVoiceBuy(t, true);
    },
    [role, doVoiceBuy],
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

  const startingRef = useRef(false);
  const start = useCallback(async () => {
    // A double tap (touch + click) used to open two sessions: two greetings,
    // two recognisers, both answering. One session at a time.
    if (startingRef.current) return;
    startingRef.current = true;
    voice.current?.stop();
    setPhase("connecting");
    setError(null);
    setResult(null);
    setCaptions([]);
    setBought(null);
    setTarget(null);
    targetRef.current = null;
    buyingRef.current = false;
    setOpen(true);
    try {
      const created = (await (
        await fetch("/api/bolo/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role, ...(role === "buyer" ? { shops: targetsRef.current } : {}) }),
        })
      ).json()) as { session_id: string; ws_url: string; token: string; error?: string };
      if (created.error || !created.ws_url) throw new Error(created.error ?? "session refused");
      voice.current = new BoloVoice(created.ws_url, created.token, {
        onPhase: (p) => {
          // Buyer: Bolo hangs up once she's said "खरीद रही हूँ"; the purchase
          // is still running, so keep showing that rather than "ended".
          if (buyingRef.current && (p === "ended" || p === "listening" || p === "bolo")) return;
          setPhase(p);
          // Merchant: on end, collect the invoice the voice server made.
          if (p === "ended" && role === "merchant") void merchantFinish(created.session_id);
        },
        onCaption: (c) => setCaptions((prev) => [...prev.slice(-6), c]),
        onAction,
      });
      await voice.current.start();
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
    } finally {
      startingRef.current = false;
    }
  }, [role, merchantFinish, onAction]);

  const hangUp = useCallback(() => voice.current?.stop(), []);

  if (enabled === null || !enabled || !pos) return null;

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
    phase === "idle" ? (role === "buyer" ? "Tap karke boliye" : "Tap karke boliye")
      : phase === "connecting" ? "Connecting…"
      : speaking ? "बोलो बोल रही है…"
      : phase === "listening" ? "सुन रही हूँ — boliye"
      : phase === "thinking" ? "सोच रही हूँ…"
      : phase === "working" ? (role === "buyer" ? "Agent पे कर रहा है…" : "इनवॉइस बन रहा है…")
      : phase === "ended" ? "Session खत्म"
      : "Connection टूटा";

  const demoLevels = () => {
    const n = Date.now() / 1000;
    return {
      bolo: phase === "bolo" ? 0.4 + 0.5 * Math.abs(Math.sin(n * 6)) : 0,
      mic: phase === "listening" ? 0.3 + 0.5 * Math.abs(Math.sin(n * 4)) : 0,
    };
  };
  const sayHello = () => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance("Hello! Namaste, main Bolo.");
      u.lang = "hi-IN";
      u.rate = 1;
      u.pitch = 1.1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* speech not available */
    }
  };
  const tapRobot = () => {
    if (demo) {
      sayHello();
      setOpen(true);
      setPhase((p) => DEMO_CYCLE[(DEMO_CYCLE.indexOf(p as Phase) + 1) % DEMO_CYCLE.length]);
      return;
    }
    // Bolo greets in her own voice once connected; the browser's "Hello"
    // on top of it was the greeting people heard twice.
    if (inCall) hangUp();
    else void start();
  };
  const panelSide = pos.x + SIZE / 2 < window.innerWidth / 2 ? "left" : "right";
  const panelDown = pos.y < 320;

  return (
    <>
      <div className="fixed z-50 select-none" style={{ left: pos.x, top: pos.y, width: SIZE }}>
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          {/* ── slide-out panel ── */}
          <div
            className={`absolute w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-line bg-surface/95 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
              open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
            }`}
            style={{
              [panelSide]: 0,
              [panelDown ? "top" : "bottom"]: SIZE + 10,
            } as React.CSSProperties}
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

            <div className="max-h-[50vh] space-y-3 overflow-y-auto px-4 py-3">
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

              {/* buyer voice-buy: matched merchant + confirm */}
              {role === "buyer" && target && !bought && phase !== "working" && (
                <div className="space-y-2 rounded-2xl border border-accent/40 bg-accentbg/30 px-3.5 py-3">
                  <p className="text-xs text-muted">Samajh gayi — khareedein?</p>
                  <p className="mono text-sm font-semibold text-accent">{target.ensName}{target.priceInrPaise ? ` · ₹${(target.priceInrPaise / 100).toFixed(0)}` : ""}</p>
                  <button
                    onClick={() => void doVoiceBuy(target)}
                    className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:text-[#0b0d1a]"
                  >
                    “Haan” boliye ya yahan tap kijiye → buy
                  </button>
                </div>
              )}
              {role === "buyer" && bought && <p className="rounded-2xl bg-okbg px-3.5 py-3 text-center text-sm font-medium text-ok">{bought} — settlement neeche dikh raha hai 🎉</p>}

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
              {!inCall && role === "buyer" && !target && (
                <p className="text-[11px] text-muted">Tap karke merchant ka naam boliye — jaise “bakery se khareedo” — phir “haan”.</p>
              )}
            </div>
          </div>

          {/* ── drag-to-move grip ── */}
          <button
            onPointerDown={onGripDown}
            aria-label="Move Bolo"
            title="Drag to move me anywhere"
            className="absolute left-1/2 top-0 z-10 flex h-6 -translate-x-1/2 cursor-grab items-center gap-1 rounded-full border border-line bg-surface/90 px-2.5 text-muted shadow backdrop-blur transition-colors hover:text-ink active:cursor-grabbing"
          >
            <span className="text-[13px] leading-none tracking-tighter">⠿⠿</span>
          </button>

          {/* ── the robot (tap = talk, drag = spin) ── */}
          <div
            className={`pointer-events-none absolute inset-2 rounded-full blur-2xl transition-opacity duration-500 ${
              speaking ? "bg-warn/35 opacity-100" : inCall ? "bg-ok/30 opacity-100" : phase === "ended" ? "bg-ok/30 opacity-90" : phase === "error" ? "bg-bad/30 opacity-90" : "bg-accent/25 opacity-80"
            }`}
          />
          <BoloRobot state={robotState} getLevels={() => (demo ? demoLevels() : voice.current?.levels() ?? { bolo: 0, mic: 0 })} onTap={tapRobot} size={SIZE} />

          {/* ── status chip ── */}
          <button
            onClick={() => setOpen((o) => !o)}
            className="mono absolute left-1/2 top-full z-10 -translate-x-1/2 -translate-y-1 whitespace-nowrap rounded-full border border-line bg-surface/90 px-3 py-1 text-[11px] text-muted shadow backdrop-blur transition-colors hover:border-accent hover:text-ink"
          >
            {inCall ? (speaking ? "🔊 बोलो live" : "🎙 सुन रही हूँ") : "बोलो"} {role === "buyer" ? "· pay" : "· invoice"}
          </button>
        </div>
      </div>

      <AgentRunOverlay state={agentRun.state} onClose={agentRun.close} />
    </>
  );
}
