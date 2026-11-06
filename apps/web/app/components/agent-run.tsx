"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FloorGrid } from "./space/kit";

/*
 * The agent-run overlay: while a purchase runs, a hologram sprinter crosses
 * the screen and a five-stage timeline (resolve ENS → fetch 402 → ENS trust
 * checks → sign USDC → receipt) paces itself on elapsed time. When the real
 * fetch answers, the timeline snaps to the true verdict: green "paid", or a
 * red 🛡 "refused" — a refusal is the guard working, never an error.
 *
 * The pacing is honest: stages only ever advance on a timer up to "sign USDC
 * = active" while the fetch is in flight, and the final states always come
 * from the API's answer. With reduced motion there is no sprint and no
 * pacing; the steps snap straight to the verdict.
 */

export type StepState = "todo" | "active" | "done" | "fail" | "skipped";

const STAGES = ["Resolve ENS", "Fetch 402", "ENS trust checks", "Sign USDC", "Receipt"] as const;
const STAGE_MS = 900;

export type RunVerdict =
  | { kind: "paid"; hashscan?: string }
  | { kind: "refused"; reason: string; message: string }
  | { kind: "soft"; message: string; signIn?: string }
  | { kind: "error"; message: string };

export type RunOutcome = { verdict: RunVerdict; body: Record<string, unknown> | null };

export type AgentRunState = {
  open: boolean;
  title: string;
  target: string;
  steps: StepState[];
  verdict: RunVerdict | null; // null while the fetch is still in flight
};

/** The overlay's final timeline for each verdict. */
function finalSteps(v: RunVerdict): StepState[] {
  if (v.kind === "paid") return ["done", "done", "done", "done", "done"];
  if (v.kind === "soft") return ["done", "done", "done", "skipped", "skipped"];
  if (v.kind === "error") return ["done", "done", "done", "fail", "skipped"];
  // A refusal fails the step that lied: a name that wouldn't resolve fails
  // "resolve ENS"; every other trust reason fails the checks stage.
  const at = v.reason === "lookup-failed" ? 0 : 2;
  return STAGES.map((_, i) => (i < at ? "done" : i === at ? "fail" : "skipped"));
}

export function useAgentRun() {
  const [state, setState] = useState<AgentRunState | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();

  const clearTimers = useCallback(() => {
    for (const t of timers.current.splice(0)) clearTimeout(t);
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const close = useCallback(() => {
    clearTimers();
    setState((s) => (s ? { ...s, open: false } : s));
  }, [clearTimers]);

  /** Open the overlay, pace the stages while `doFetch` runs, snap to its verdict. */
  const run = useCallback(
    async (cfg: { title: string; target: string }, doFetch: () => Promise<RunOutcome>): Promise<RunOutcome> => {
      clearTimers();
      setState({ open: true, ...cfg, steps: STAGES.map(() => "todo" as StepState), verdict: null });

      // Pace the first four stages on elapsed time; the receipt stage is
      // reached only on a real "paid". Timers never clobber a verdict.
      if (!reduce) {
        for (let i = 0; i < STAGES.length - 1; i++) {
          timers.current.push(
            setTimeout(() => {
              setState((s) =>
                s && s.verdict === null ? { ...s, steps: STAGES.map((_, j) => (j < i ? "done" : j === i ? "active" : s.steps[j]!)) } : s,
              );
            }, i * STAGE_MS),
          );
        }
      }

      let outcome: RunOutcome;
      try {
        outcome = await doFetch();
      } catch (err) {
        outcome = { verdict: { kind: "error", message: (err as Error).message }, body: null };
      }
      clearTimers();
      setState((s) => (s ? { ...s, steps: finalSteps(outcome.verdict), verdict: outcome.verdict } : s));
      return outcome;
    },
    [clearTimers, reduce],
  );

  return { state, run, close };
}

/**
 * Shared mapper for every "pay as agent" call site (the dashboard, the buyer
 * desk, the demo shop): POST to an agent route and turn its answer into a
 * verdict. `refused` stays a refusal; 401 is the anonymous-judge soft verdict;
 * anything else is an error with the route's own message.
 */
export async function runPayAsAgent(
  run: ReturnType<typeof useAgentRun>["run"],
  cfg: { title: string; target: string },
  body: Record<string, unknown>,
  endpoint: string,
): Promise<RunOutcome> {
  return run(cfg, async () => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const error = typeof data.error === "string" ? data.error : `failed (${res.status})`;
    if (data.refused) {
      return {
        verdict: {
          kind: "refused",
          reason: typeof data.reason === "string" ? data.reason : "untrusted",
          message: typeof data.error === "string" ? data.error : "The invoice did not pass the ENS checks.",
        },
        body: data,
      };
    }
    if (res.status === 401) {
      return {
        verdict: {
          kind: "soft",
          message: error,
          signIn: typeof data.signIn === "string" ? data.signIn : "/verify?role=user",
        },
        body: data,
      };
    }
    if (data.hederaTxId) return { verdict: { kind: "paid", hashscan: typeof data.hashscan === "string" ? data.hashscan : undefined }, body: data };
    return { verdict: { kind: "error", message: error }, body: data };
  });
}

/* ───────────────────────── overlay ───────────────────────── */

function RunDot({ state }: { state: StepState }) {
  const base = "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-300";
  switch (state) {
    case "done":
      return <span className={`${base} bg-ok text-white dark:text-[#0b0d1a]`}>✓</span>;
    case "active":
      return (
        <span className={`${base} bg-accent text-white dark:text-[#0b0d1a]`}>
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/40" />
          <Spinner />
        </span>
      );
    case "fail":
      return <span className={`${base} bg-bad text-white dark:text-[#0b0d1a]`}>✕</span>;
    case "skipped":
      return <span className={`${base} border-2 border-dashed border-line text-muted`}>–</span>;
    default:
      return <span className={`${base} border-2 border-line bg-surface text-muted`}>·</span>;
  }
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** The hologram sprinter: CSS-3D planes, no WebGL. Sprinting left → right. */
function HoloRunner({ running }: { running: boolean }) {
  return (
    <AnimatePresence>
      {running && (
        <motion.div
          key="runner"
          aria-hidden
          className="pointer-events-none absolute bottom-10 left-0"
          initial={{ x: "-15vw", opacity: 0 }}
          animate={{ x: "112vw", opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
          transition={{ x: { duration: 2.6, ease: "linear", repeat: Infinity }, opacity: { duration: 0.3 } }}
          style={{ willChange: "transform" }}
        >
          <div className="relative h-24 w-14" style={{ perspective: 420 }}>
            {/* light trail behind the sprinter */}
            <span className="holo-streak" />
            {/* two spinning floor rings under the feet */}
            <span className="holo-ring" />
            <span className="holo-ring holo-ring-2" />
            <div className="holo-runner">
              <div className="holo-plane holo-head" />
              <div className="holo-plane holo-torso" />
              <div className="holo-plane holo-leg holo-leg-a" />
              <div className="holo-plane holo-leg holo-leg-b" />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function VerdictBanner({ verdict }: { verdict: RunVerdict }) {
  const anim = {
    initial: { opacity: 0, y: 10, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.3 },
  };
  if (verdict.kind === "paid")
    return (
      <motion.div {...anim} className="rounded-xl bg-okbg px-4 py-3 text-sm text-ok ring-1 ring-ok/30" role="status">
        <span className="font-semibold">Paid.</span> The {verdict.hashscan?.includes("whitechain") ? "USDT transfer is on Whitechain" : "USDC transfer is on Hedera"}; the merchant gets rupees on UPI.
        {verdict.hashscan && (
          <>
            {" · "}
            <a className="underline underline-offset-2" href={verdict.hashscan} target="_blank" rel="noreferrer">
              {verdict.hashscan.includes("whitechain") ? "Whitechain explorer" : "HashScan"} ↗
            </a>
          </>
        )}
      </motion.div>
    );
  if (verdict.kind === "refused")
    return (
      <motion.div {...anim} className="rounded-xl bg-badbg px-4 py-3 text-sm text-bad ring-1 ring-bad/30" role="status">
        <span className="font-semibold">🛡️ Refused — nothing was signed, no money moved.</span> {verdict.message}
      </motion.div>
    );
  if (verdict.kind === "soft")
    return (
      <motion.div {...anim} className="rounded-xl bg-warnbg px-4 py-3 text-sm text-warn ring-1 ring-warn/30" role="status">
        <span className="font-semibold">The checks passed.</span>{" "}
        <a className="underline underline-offset-2" href={verdict.signIn ?? "/verify?role=user"}>
          Sign in as a buyer
        </a>{" "}
        to let the agent make the real payment.
      </motion.div>
    );
  return (
    <motion.div {...anim} className="rounded-xl bg-badbg px-4 py-3 text-sm text-bad ring-1 ring-bad/30" role="status">
      {verdict.message}
    </motion.div>
  );
}

export function AgentRunOverlay({ state, onClose }: { state: AgentRunState | null; onClose: () => void }) {
  const open = state?.open ?? false;
  const verdict = state?.verdict ?? null;
  const running = open && verdict === null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const summary = !open
    ? ""
    : verdict?.kind === "paid"
      ? "Payment paid."
      : verdict?.kind === "refused"
        ? "Payment refused. Nothing was signed."
        : running
          ? `Agent is working: ${STAGES[state!.steps.indexOf("active")] ?? "starting"}`
          : "Agent run ended.";

  return (
    <AnimatePresence>
      {open && state && (
        <motion.div
          key="agent-run"
          className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* backdrop */}
          <motion.div
            className="absolute inset-0 bg-[#05060d]/70 backdrop-blur-md"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <p className="sr-only" aria-live="polite">{summary}</p>

          <motion.div
            className="relative w-full max-w-2xl overflow-hidden rounded-3xl bg-[#0c0e1c]/95 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.9),0_20px_60px_-30px_rgba(99,102,241,0.6)] ring-1 ring-white/15"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.35 }}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Agent run</p>
                <p className="mt-0.5 truncate text-lg font-semibold tracking-tight">{state.title}</p>
                <p className="mono truncate text-xs text-muted">{state.target}</p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-ink"
              >
                Esc ✕
              </button>
            </div>

            {/* the sprint track */}
            <div className="relative mt-3 h-40 overflow-hidden" style={{ perspective: 700 }}>
              <FloorGrid className="h-1/2 opacity-70" />
              <HoloRunner running={running} />
              {!running && verdict === null && (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">Starting…</p>
              )}
            </div>

            {/* timeline */}
            <div className="glass-3d border-t border-white/10 px-6 py-5">
              <ol className="flex items-start justify-between gap-1">
                {STAGES.map((label, i) => (
                  <li key={label} className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                    <RunDot state={state.steps[i]!} />
                    <span className={`text-[11px] leading-tight ${state.steps[i] === "active" ? "font-semibold text-ink" : "text-muted"}`}>
                      {label}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 min-h-[52px]">
                <AnimatePresence mode="wait">{verdict && <VerdictBanner key={verdict.kind} verdict={verdict} />}</AnimatePresence>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
