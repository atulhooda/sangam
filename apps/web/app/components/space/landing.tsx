"use client";

/*
 * Landing sections in the Oryn "space" design language, carrying Sangam's story:
 * a nav pill, a planet-horizon hero, a 3D card stack with live numbers, an
 * exploded 3D stack of the rail's layers, a call to action and a footer.
 */
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { Stats } from "@/lib/types";
import { AccountMenu } from "../account-menu";
import { CountUp, EASE, Eyebrow, FloorGrid, Horizon, Logo, PillCTA, Reveal, SangamMark, Starfield, TwoTone } from "./kit";

/* ── live numbers ── */

export function useStats(): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/stats", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => alive && s && setStats(s))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return stats;
}

/* ── nav ── */

const LINKS = [
  { label: "The gap", href: "#gap" },
  { label: "How it works", href: "#how" },
  { label: "The rail", href: "#layers" },
  { label: "What it is", href: "#what" },
];

export function Nav() {
  const reduce = useReducedMotion();
  return (
    <motion.header
      className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4"
      initial={{ opacity: 0, y: reduce ? 0 : -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.9, ease: EASE, delay: 0.05 }}
    >
      <div className="pointer-events-auto flex h-[52px] w-full max-w-[920px] items-center justify-between gap-4 rounded-full bg-[#0d0e1a]/70 pl-5 pr-1.5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/10 backdrop-blur-xl">
        <Link href="/" aria-label="Sangam home" className="shrink-0">
          <Logo />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 text-[13px] lg:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-white/65 transition-colors hover:text-white">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden sm:block">
            <AccountMenu />
          </span>
          <Link href="/dashboard" className="inline-flex h-9 items-center rounded-full bg-white px-4 text-[13px] font-medium text-[#0b0b14] transition-colors hover:bg-white/90">
            Watch it live
          </Link>
        </div>
      </div>
    </motion.header>
  );
}

/* ── hero ── */

function PlanetHorizon({ children, caption }: { children?: ReactNode; caption?: ReactNode }) {
  const reduce = useReducedMotion();
  const t = (d: number, dur = 1.6) => ({ duration: reduce ? 0 : dur, ease: EASE, delay: reduce ? 0 : 0.2 + d });
  return (
    <div className="relative min-h-[340px] flex-1 sm:min-h-[380px]">
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[40%] h-[300px] w-[220%] -translate-x-1/2 -translate-y-full sm:h-[360px] sm:w-[200%]"
        initial={{ opacity: 0, y: 80 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.15, 2.4)}
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_100%_at_50%_100%,rgba(99,102,241,0.5),rgba(79,70,229,0.18)_45%,transparent_72%)]" />
        <div className="absolute inset-x-[14%] bottom-0 h-[48%] bg-[radial-gradient(ellipse_50%_100%_at_50%_100%,rgba(129,140,248,0.8),rgba(99,102,241,0.3)_50%,transparent_82%)] blur-xl" />
        <div className="absolute inset-x-[30%] bottom-0 h-[20%] bg-[radial-gradient(ellipse_50%_100%_at_50%_100%,rgba(199,210,254,0.7),transparent_78%)] blur-lg" />
      </motion.div>

      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2" style={{ width: "max(240vw, 1500px)", height: "max(70vw, 520px)" }}>
        <motion.div
          className="absolute inset-0 rounded-[50%]"
          style={{ background: "radial-gradient(ellipse 60% 40% at 50% 0%, #2a2c42 0%, #161727 30%, #0a0b16 60%, #05060d 100%)" }}
          initial={{ boxShadow: "0 -2px 6px rgba(199,210,254,0), 0 -30px 120px 10px rgba(99,102,241,0)" }}
          animate={{ boxShadow: "0 -1px 10px rgba(199,210,254,0.85), 0 -30px 120px 10px rgba(99,102,241,0.45)" }}
          transition={t(0.5, 2)}
        />
        <motion.div className="absolute inset-0 rounded-[50%] border-t-[1.5px] border-white/90" initial={{ opacity: 0.15 }} animate={{ opacity: 1 }} transition={t(0.6, 2)} />
        <div className="absolute inset-0 rounded-[50%] shadow-[inset_0_24px_60px_-28px_rgba(165,180,252,0.45)]" />
      </div>

      <div className="absolute left-1/2 top-[40%] z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <motion.div className="relative" initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={t(0.9, 1.1)}>
          <span aria-hidden className="absolute -inset-6 -z-10 rounded-full bg-white/20 blur-2xl" />
          {children}
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] h-10 w-[88%] -translate-x-1/2 rounded-full bg-white/[0.07] blur-md" />
        </motion.div>
      </div>

      {/* two lights travel along the rim and meet: USDC from the left, rupees from the right */}
      {!reduce && (
        <>
          <motion.span
            aria-hidden
            className="pointer-events-none absolute top-[40%] z-10 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-sky-200 shadow-[0_0_10px_3px_rgba(147,197,253,0.9)]"
            animate={{ left: ["30%", "49%"], opacity: [0, 1, 0] }}
            transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity, delay: 2 }}
          />
          <motion.span
            aria-hidden
            className="pointer-events-none absolute top-[40%] z-10 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-emerald-200 shadow-[0_0_10px_3px_rgba(110,231,183,0.9)]"
            animate={{ left: ["70%", "51%"], opacity: [0, 1, 0] }}
            transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity, delay: 2 }}
          />
        </>
      )}

      {caption && (
        <motion.p className="absolute inset-x-0 top-[calc(40%+92px)] z-10 px-6 text-center text-[11px] text-white/40 sm:text-xs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t(1.2, 1.2)}>
          {caption}
        </motion.p>
      )}
    </div>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  const lift = (d: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 22, filter: reduce ? "none" : "blur(6px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: reduce ? 0 : 1, ease: EASE, delay: reduce ? 0 : d },
  });
  return (
    <section id="main" tabIndex={-1} className="relative flex min-h-[100svh] flex-col overflow-hidden bg-[#05060d] outline-none">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_50%_0%,rgba(30,32,70,0.35),transparent_70%)]" />
      <Starfield count={80} />
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-5 pt-36 text-center sm:pt-44">
        <motion.p className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3.5 py-1.5 text-xs text-white/60 ring-1 ring-white/10 backdrop-blur" {...lift(0)}>
          <SangamMark size={13} className="text-indigo-300" />
          Settlement rail for the agent economy
        </motion.p>
        <motion.h1 className="font-medium leading-[1.04] tracking-[-0.035em]" {...lift(0.1)}>
          <span className="block text-balance text-[2.3rem] leading-[1.05] text-white sm:text-5xl lg:text-[3.8rem]">Agents pay in USDC.</span>
          <span className="mt-1 block text-balance text-[2.3rem] leading-[1.05] text-white/45 sm:text-5xl lg:text-[3.8rem]">Merchants get rupees.</span>
        </motion.h1>
        <motion.p className="mt-7 max-w-xl text-sm leading-relaxed text-white/55 sm:text-[15px]" {...lift(0.3)}>
          An AI agent buys from an Indian merchant over x402 on Hedera. Sangam checks the payment on-chain, decides with 0G, pays the
          merchant in INR over UPI, and writes a receipt nobody can change.
        </motion.p>
      </div>
      <PlanetHorizon caption="Live on Hedera testnet · merchants found by ENS · payouts over UPI">
        <PillCTA href="/dashboard">Watch a payment settle</PillCTA>
      </PlanetHorizon>
    </section>
  );
}

/* ── 3D card stack ── */

function CardChip() {
  return (
    <span
      aria-hidden
      className="relative block h-[30px] w-[40px] overflow-hidden rounded-[7px] bg-[linear-gradient(135deg,#f3f4f8,#c3c6d4_50%,#eef0f6)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_2px_6px_rgba(0,0,0,0.25)] ring-1 ring-white/40"
    >
      <span className="absolute inset-y-[7px] left-0 right-0 border-y border-black/15" />
      <span className="absolute inset-x-[13px] inset-y-0 border-x border-black/15" />
      <span className="absolute left-1/2 top-1/2 h-[10px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-[3px] border border-black/15" />
    </span>
  );
}

function RupeeCard({ amount, upi }: { amount: string; upi: string }) {
  return (
    <div className="relative aspect-[1.586/1] w-full overflow-hidden rounded-[22px] bg-[linear-gradient(125deg,#f5f5f8_0%,#d9dbe4_38%,#b7bac8_62%,#e4e5ec_100%)] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.75),0_10px_30px_-10px_rgba(16,185,129,0.35)] ring-1 ring-white/60">
      <div className="absolute inset-0 bg-[linear-gradient(105deg,transparent_30%,rgba(255,255,255,0.75)_45%,transparent_58%)] opacity-70" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_110%,rgba(52,211,153,0.28),transparent_60%)]" />
      <div className="relative flex h-full flex-col justify-between p-[7%] text-[#1a1b26]">
        <div className="flex items-start justify-between">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
            <SangamMark size={16} /> sangam
          </span>
          <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-[#1a1b26]/45">Merchant · UPI</span>
        </div>
        <CardChip />
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#1a1b26]/50">Paid out</div>
            <div className="truncate text-lg font-medium tracking-[-0.02em] sm:text-xl">{amount}</div>
            <div className="mono mt-0.5 truncate text-[11px] text-[#1a1b26]/55">{upi}</div>
          </div>
          <span className="text-2xl font-semibold text-[#1a1b26]/30">₹</span>
        </div>
      </div>
    </div>
  );
}

function UsdcCard({ amount, account }: { amount: string; account: string }) {
  return (
    <div className="relative aspect-[1.586/1] w-full overflow-hidden rounded-[22px] bg-[linear-gradient(130deg,#3b3fe0_0%,#2a2bb8_32%,#1c1a80_62%,#120f4a_100%)] shadow-[0_50px_90px_-20px_rgba(0,0,0,0.85),0_20px_60px_-20px_rgba(79,70,229,0.75)] ring-1 ring-white/15">
      <div className="absolute -left-1/4 -top-1/2 h-[140%] w-[70%] rotate-[25deg] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)] blur-md" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_25%_0%,rgba(165,180,252,0.45),transparent_55%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-[7%] text-white">
        <div className="flex items-start justify-between">
          <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold tracking-tight">
            <SangamMark size={16} /> sangam
          </span>
          <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-white/55">Agent · Hedera</span>
        </div>
        <CardChip />
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">Paying</div>
            <div className="truncate text-lg font-medium tracking-[-0.02em] sm:text-xl">{amount}</div>
            <div className="mono mt-0.5 truncate text-[11px] text-white/55">{account}</div>
          </div>
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide ring-1 ring-white/20">x402</span>
        </div>
      </div>
    </div>
  );
}

function CardStack() {
  const reduce = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 60, damping: 18 });
  const sy = useSpring(my, { stiffness: 60, damping: 18 });
  const rotY = useTransform(sx, [-1, 1], [-9, 9]);
  const rotX = useTransform(sy, [-1, 1], [7, -7]);
  const backX = useTransform(sx, [-1, 1], [-12, 12]);
  const backY = useTransform(sy, [-1, 1], [-9, 9]);

  function onMove(e: MouseEvent<HTMLDivElement>) {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
    my.set(((e.clientY - r.top) / r.height) * 2 - 1);
  }
  const float = (amp: number, dur: number, delay = 0) =>
    reduce ? {} : { animate: { y: [0, -amp, 0] }, transition: { duration: dur, ease: "easeInOut" as const, repeat: Infinity, delay } };

  return (
    <div
      onMouseMove={onMove}
      onMouseLeave={() => {
        mx.set(0);
        my.set(0);
      }}
      className="relative mx-auto aspect-[1.25/1] w-full max-w-[560px] [perspective:1400px]"
    >
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[80%] w-[90%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(79,70,229,0.45),transparent_65%)] blur-2xl" />
      <motion.div style={{ rotateX: rotX, rotateY: rotY }} className="absolute inset-0 [transform-style:preserve-3d]">
        <motion.div className="absolute right-0 top-[2%] w-[64%]" style={{ x: backX, y: backY }}>
          <motion.div initial={{ opacity: 0, x: 40, y: -20 }} whileInView={{ opacity: 1, x: 0, y: 0 }} viewport={{ once: true }} transition={{ duration: 1.1, ease: EASE, delay: 0.15 }}>
            <motion.div {...float(8, 7, 0.6)}>
              <div className="[transform:rotate(-9deg)_rotateY(-14deg)_rotateX(6deg)]">
                <RupeeCard amount="₹48.75" upi="tickets@razorpay" />
              </div>
            </motion.div>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: -40, y: 30 }}
          whileInView={{ opacity: 1, x: 0, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: EASE, delay: 0.3 }}
          className="absolute left-[4%] top-[24%] w-[76%]"
        >
          <motion.div {...float(12, 6)}>
            <div className="[transform:rotate(7deg)_rotateY(-12deg)_rotateX(8deg)_translateZ(40px)]">
              <UsdcCard amount="0.52 USDC" account="tickets.sangam.eth" />
            </div>
          </motion.div>
        </motion.div>

        <div className="absolute bottom-[10%] left-[5%] [transform:translateZ(90px)] sm:bottom-[12%]">
          <motion.div initial={{ opacity: 0, y: 16, scale: 0.95 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE, delay: 0.7 }}>
            <motion.div
              {...float(6, 5, 1.2)}
              className="flex items-center gap-2.5 rounded-full bg-white/[0.07] py-2 pl-2 pr-4 shadow-[0_20px_40px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/15 backdrop-blur-xl"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#4f46e5] shadow-[0_0_16px_rgba(99,102,241,0.8)]">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2.5 6.2 5 8.5l4.5-5" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="text-[13px] font-medium text-white/85">Receipt on Hedera</span>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

export function CardsHero() {
  const stats = useStats();
  const inr = (stats?.inrPaidOutPaise ?? 0) / 100;
  const usdcIn = Number(stats?.usdcInAtomic ?? 0) / 1e6;
  const cells = [
    { node: <CountUp value={stats?.count ?? 0} />, label: "payments settled" },
    { node: <CountUp value={stats?.paidCount ?? 0} />, label: "paid out to merchants" },
    { node: <CountUp value={usdcIn} decimals={2} />, label: "USDC received" },
    { node: <CountUp value={inr} decimals={2} prefix="₹" />, label: "rupees paid over UPI" },
  ];

  return (
    <section className="relative isolate overflow-hidden bg-[#05060d] pb-16 pt-24 sm:pb-20 sm:pt-32">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#05060d_0%,#080a1c_55%,#0d0f2e_100%)]" />
        <div className="absolute -bottom-[20%] -right-[10%] h-[85%] w-[75%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(79,70,229,0.55),rgba(67,56,202,0.18)_45%,transparent_70%)] blur-3xl" />
        <div className="absolute -bottom-[30%] left-[10%] h-[50%] w-[60%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(67,56,202,0.35),transparent_70%)] blur-3xl" />
      </div>
      <Starfield count={40} className="-z-10 opacity-40" />

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-8">
          <div>
            <Reveal>
              <Eyebrow>One payment, two currencies</Eyebrow>
              <TwoTone top="The agent pays a name." bottom="The shop's phone buzzes." className="text-[2.15rem] leading-[1.06] sm:text-5xl xl:text-[3.4rem]" />
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-6 max-w-[27rem] text-[15px] leading-relaxed text-white/55">
                The buyer agent finds <span className="mono text-white/75">tickets.sangam.eth</span>, pays 0.52 USDC on Hedera, and gets its
                ticket. Seconds later the merchant receives ₹48.75 on UPI. Nobody touches an exchange.
              </p>
            </Reveal>
            <Reveal delay={0.2}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center rounded-full bg-[#c9cad3] px-6 py-3 text-sm font-medium text-[#0b0b14] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_30px_-10px_rgba(129,140,248,0.5)] transition hover:-translate-y-0.5 hover:bg-white"
                >
                  Open the settlement desk
                </Link>
                <Link href="/merchant/onboarding" className="inline-flex items-center rounded-full px-6 py-3 text-sm font-medium text-white/60 transition hover:bg-white/[0.05] hover:text-white">
                  Become a merchant
                </Link>
              </div>
            </Reveal>
          </div>
          <CardStack />
        </div>

        <Reveal delay={0.15} className="mt-20 sm:mt-24">
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10 backdrop-blur-md lg:grid-cols-4">
            {cells.map((c, i) => (
              <div
                key={c.label}
                className={`min-w-0 px-5 py-5 sm:px-10 sm:py-6 ${i % 2 === 1 ? "border-l border-white/[0.06]" : ""} ${i >= 2 ? "border-t border-white/[0.06] lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}
              >
                <div className="text-xl font-medium tracking-[-0.03em] text-white sm:text-2xl">{c.node}</div>
                <div className="mt-1.5 text-xs text-white/45">{c.label}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-[11px] text-white/35">
            {stats ? `Live from this Sangam instance · ${stats.mode === "live" ? "all services live" : stats.mode === "mixed" ? "some services mocked" : "simulation mode"}` : "Connecting to Sangam…"}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ── exploded 3D stack of the rail ── */

const LAYERS = [
  { name: "UPI payout", note: "Rupees to the merchant's bank, from Sangam's float", tone: "from-emerald-400/35 to-emerald-500/10", ring: "ring-emerald-300/40", dot: "bg-emerald-300" },
  { name: "0G decision", note: "AI risk check: pay out or hold, and the fee", tone: "from-fuchsia-400/30 to-fuchsia-500/10", ring: "ring-fuchsia-300/40", dot: "bg-fuchsia-300" },
  { name: "Hedera settlement", note: "USDC lands; Mirror Node confirms; HCS keeps the receipt", tone: "from-indigo-400/40 to-indigo-500/10", ring: "ring-indigo-300/50", dot: "bg-indigo-300" },
  { name: "x402 invoice", note: "HTTP 402: a bill an agent can read and pay", tone: "from-sky-400/35 to-sky-500/10", ring: "ring-sky-300/40", dot: "bg-sky-300" },
  { name: "ENS identity", note: "tickets.sangam.eth: who to pay, where, and how much", tone: "from-violet-300/35 to-violet-500/10", ring: "ring-violet-200/40", dot: "bg-violet-200" },
];

/** One slab of the exploded stack, lifted off the floor by `index × spread`. */
function Plate({ layer: l, index: i, spread, active }: { layer: (typeof LAYERS)[number]; index: number; spread: MotionValue<number>; active: boolean }) {
  const z = useTransform(spread, (s) => (i - 2) * s);
  return (
    <motion.div
      className={`absolute inset-0 rounded-[28px] bg-gradient-to-br ${l.tone} ring-1 ${l.ring} backdrop-blur-sm`}
      style={{
        z,
        boxShadow: active ? "0 0 60px 4px rgba(129,140,248,0.45), 0 14px 0 rgba(20,18,60,0.85)" : "0 14px 0 rgba(15,14,40,0.85)",
      }}
      animate={{ opacity: active ? 1 : 0.55, scale: active ? 1.04 : 1 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      <div className="absolute inset-0 rounded-[28px] bg-[linear-gradient(to_right,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.07)_1px,transparent_1px)] bg-[size:28px_28px]" />
      <span className="absolute left-6 top-5 text-sm font-semibold tracking-tight text-white/90">{l.name}</span>
      {i === 2 && (
        <span className="absolute bottom-5 right-6 grid h-10 w-10 place-items-center rounded-xl bg-white/90 text-[#3b2fd6] shadow-[0_0_24px_rgba(165,180,252,0.9)]">
          <SangamMark size={22} />
        </span>
      )}
    </motion.div>
  );
}

export function LayerStack() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const spread = useTransform(scrollYProgress, [0.1, 0.5], reduce ? [46, 46] : [14, 46]);
  const spin = useTransform(scrollYProgress, [0, 1], reduce ? [-40, -40] : [-52, -28]);
  const [active, setActive] = useState(2);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setActive((a) => (a + 4) % LAYERS.length), 1800);
    return () => clearInterval(t);
  }, [reduce]);

  return (
    <section id="layers" ref={ref} className="relative isolate overflow-hidden bg-[#05060d] py-24 sm:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_70%_55%,rgba(67,56,202,0.35),transparent_70%)]" />
      <FloorGrid className="-z-10 h-1/2" />
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Reveal>
            <Eyebrow>The rail, layer by layer</Eyebrow>
            <TwoTone top="Five layers." bottom="One payment through all of them." className="text-[2rem] leading-[1.08] sm:text-5xl" />
          </Reveal>
          <ol className="mt-10 space-y-2">
            {[...LAYERS].reverse().map((l) => {
              const i = LAYERS.indexOf(l);
              const on = i === active;
              return (
                <li key={l.name}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    className={`flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition ${on ? "bg-white/[0.06] ring-1 ring-white/15" : "hover:bg-white/[0.03]"}`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${l.dot} ${on ? "shadow-[0_0_10px_2px_currentColor]" : "opacity-50"}`} />
                    <span className="min-w-0">
                      <span className={`block text-[15px] font-medium ${on ? "text-white" : "text-white/60"}`}>{l.name}</span>
                      <span className="block text-sm text-white/45">{l.note}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="relative mx-auto aspect-square w-full max-w-[520px] [perspective:1600px]" aria-hidden>
          <motion.div className="absolute inset-[14%] [transform-style:preserve-3d]" style={{ rotateX: 58, rotateZ: spin }}>
            {LAYERS.map((l, i) => (
              <Plate key={l.name} layer={l} index={i} spread={spread} active={i === active} />
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ── call to action + footer ── */

export function CTABand() {
  return (
    <section className="relative isolate overflow-hidden bg-[#05060d] pb-40 pt-24 text-center">
      <Starfield count={50} className="-z-10 opacity-60" />
      <Horizon className="bottom-0 -z-10 h-[260px]" />
      <div className="mx-auto max-w-3xl px-5">
        <Reveal>
          <TwoTone top="Ready to see rupees land?" bottom="It takes about ten seconds." className="text-[2rem] leading-[1.08] sm:text-5xl" />
        </Reveal>
        <Reveal delay={0.15}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <PillCTA href="/dashboard">Open the settlement desk</PillCTA>
            <Link href="/demo/shops" className="inline-flex items-center rounded-full px-6 py-3 text-sm font-medium text-white/60 ring-1 ring-white/10 transition hover:bg-white/[0.05] hover:text-white">
              Watch ENS stop a hacked shop
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="relative border-t border-white/[0.06] bg-[#05060d]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-5 py-10 text-sm text-white/45">
        <div className="flex flex-col gap-2">
          <Logo />
          <p>Built on Hedera, 0G and ENSv2 for ETHGlobal Mumbai.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-5">
          <Link href="/dashboard" className="hover:text-white">Settlement desk</Link>
          <Link href="/buyer" className="hover:text-white">Buyer desk</Link>
          <Link href="/demo/shops" className="hover:text-white">Hacked-shop demo</Link>
          <Link href="/merchant/onboarding" className="hover:text-white">Become a merchant</Link>
          <a href="https://ethglobal.com/events/mumbai" className="hover:text-white">ETHGlobal Mumbai</a>
        </nav>
      </div>
    </footer>
  );
}
