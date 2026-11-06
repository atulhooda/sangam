"use client";

/*
 * Sangam's "space" design kit, adapted from the Oryn UI: deep navy, indigo
 * light, a starfield, a glowing planet horizon, two-tone headlines, white
 * pill buttons and 3D surfaces that tilt toward the pointer.
 */
import {
  animate,
  motion,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

export const EASE = [0.22, 1, 0.36, 1] as const;

/* ── brand ── */

/** Sangam's mark: two streams (USDC and rupees) meeting and flowing on as one. */
export function SangamMark({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 3c0 7 8 6 8 13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M20 3c0 7-8 6-8 13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" opacity="0.7" />
      <path d="M12 16v5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** The app tile: white mark on an indigo, lit-from-above square. */
export function SangamTile({ size = 26 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="dark inline-grid shrink-0 place-items-center rounded-[28%] bg-[linear-gradient(160deg,#6d6af8,#3b2fd6)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_6px_18px_-6px_rgba(99,102,241,0.9)]"
      style={{ width: size, height: size }}
    >
      <SangamMark size={Math.round(size * 0.62)} className="text-white" />
    </span>
  );
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight ${dark ? "text-[#0b0b14]" : "text-white"}`}>
      <SangamTile size={24} />
      sangam
      <span className={`text-xs font-normal ${dark ? "text-black/40" : "text-white/35"}`}>संगम</span>
    </span>
  );
}

/* ── motion helpers ── */

/** Fades and lifts its children into view once, when scrolled into the viewport. */
export function Reveal({ children, delay = 0, y = 24, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Counts up to `value` the first time it scrolls into view. */
export function CountUp({ value, decimals = 0, prefix = "", suffix = "" }: { value: number; decimals?: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(current.current, value, {
      duration: reduce ? 0 : current.current === 0 ? 1.8 : 0.8,
      ease: EASE,
      onUpdate: (v) => {
        current.current = v;
        setShown(v);
      },
    });
    return () => controls.stop();
  }, [inView, value, reduce]);

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {shown.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

/**
 * A 3D surface that tilts toward the pointer, with a soft glare that follows it.
 * `max` is the tilt in degrees: keep it small (2–4) for panels people read.
 */
export function Tilt3D({
  children,
  max = 6,
  glare = true,
  className = "",
  innerClassName = "",
  as = "div",
}: {
  children: ReactNode;
  max?: number;
  glare?: boolean;
  className?: string;
  innerClassName?: string;
  as?: "div" | "section";
}) {
  const reduce = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 120, damping: 18 });
  const sy = useSpring(my, { stiffness: 120, damping: 18 });
  const rotateY = useTransform(sx, [-1, 1], [-max, max]);
  const rotateX = useTransform(sy, [-1, 1], [max, -max]);
  const gx = useTransform(sx, [-1, 1], [0, 100]);
  const gy = useTransform(sy, [-1, 1], [0, 100]);
  const glareBg = useMotionTemplate`radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,0.10), transparent 55%)`;
  const [hover, setHover] = useState(false);

  function onMove(e: MouseEvent<HTMLElement>) {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
    my.set(((e.clientY - r.top) / r.height) * 2 - 1);
  }
  function onLeave() {
    mx.set(0);
    my.set(0);
    setHover(false);
  }

  const Inner = as === "section" ? motion.section : motion.div;
  return (
    <div className={`[perspective:1200px] ${className}`} onMouseMove={onMove} onMouseEnter={() => setHover(true)} onMouseLeave={onLeave}>
      <Inner
        style={reduce ? undefined : { rotateX, rotateY, transformStyle: "preserve-3d" }}
        animate={reduce ? undefined : { y: hover ? -3 : 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className={`relative h-full ${innerClassName}`}
      >
        {children}
        {glare && !reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
            style={{ background: glareBg, opacity: hover ? 1 : 0 }}
          />
        )}
      </Inner>
    </div>
  );
}

/* ── type and controls ── */

/** Two-line headline: first line bright, second line dimmed. */
export function TwoTone({
  top,
  bottom,
  className = "",
  as: Tag = "h2",
}: {
  top: ReactNode;
  bottom?: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <Tag className={`text-balance font-medium tracking-[-0.035em] ${className}`}>
      <span className="block text-white">{top}</span>
      {bottom && <span className="block text-white/45">{bottom}</span>}
    </Tag>
  );
}

/** White pill button with a dark circular arrow. */
export function PillCTA({ href, children, dark = false }: { href: string; children: ReactNode; dark?: boolean }) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-3 rounded-full py-1.5 pl-5 pr-1.5 text-sm font-medium shadow-[0_8px_40px_-8px_rgba(120,120,255,0.55)] transition hover:-translate-y-0.5 ${
        dark ? "bg-black text-white" : "bg-white text-black"
      }`}
    >
      {children}
      <span
        className={`grid h-7 w-7 place-items-center rounded-full transition group-hover:translate-x-0.5 ${
          dark ? "bg-white text-black" : "bg-black text-white"
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2 6h8m0 0L6.5 2.5M10 6 6.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Link>
  );
}

/** Small rounded label for tabs, chips and tags. */
export function Chip({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-medium backdrop-blur ${
        active ? "bg-white/15 text-white ring-1 ring-white/25" : "bg-white/[0.06] text-white/55 ring-1 ring-white/10"
      }`}
    >
      {children}
    </span>
  );
}

/** Small uppercase label above a section headline. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em] text-indigo-300/80">{children}</p>;
}

/* ── backgrounds ── */

/** Twinkling stars. Deterministic positions (no Math.random during render). */
export function Starfield({ count = 70, className = "" }: { count?: number; className?: string }) {
  const stars = Array.from({ length: count }, (_, i) => {
    const a = (i * 9301 + 49297) % 233280;
    const b = (i * 4973 + 1297) % 233280;
    return { left: (a / 233280) * 100, top: (b / 233280) * 100, size: i % 7 === 0 ? 2 : 1, delay: (i % 10) * 0.4 };
  });
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      {stars.map((s, i) => (
        <span
          key={i}
          className="absolute animate-glow rounded-full bg-white"
          style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s`, opacity: 0.5 }}
        />
      ))}
    </div>
  );
}

/** A dark planet arc lit from behind in indigo. */
export function Horizon({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-x-0 overflow-hidden ${className}`} aria-hidden>
      <div className="absolute left-1/2 top-0 h-[60%] w-[140%] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.85),rgba(79,70,229,0.35)_40%,transparent_70%)] blur-2xl" />
      <div className="absolute left-1/2 top-[22%] h-[200%] w-[160%] -translate-x-1/2 planet-rim rounded-[100%] border-t border-white/70 bg-bg shadow-[0_-20px_80px_10px_rgba(129,140,248,0.55),inset_0_30px_60px_-30px_rgba(165,180,252,0.35)]" />
    </div>
  );
}

/** Deep navy section background with a soft indigo glow. */
export function NavyGlow({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`} aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_75%,rgba(67,56,202,0.40),transparent_70%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--color-bg),transparent_30%,transparent_70%,var(--color-bg))]" />
    </div>
  );
}

/** Perspective floor grid that recedes into the distance. */
export function FloorGrid({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-1/3 [perspective:600px] ${className}`} aria-hidden>
      <div className="absolute inset-0 origin-bottom [transform:rotateX(65deg)] bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:linear-gradient(to_top,black,transparent)]" />
    </div>
  );
}

/** Fixed background behind every page: navy, a few stars, indigo light and a far floor grid. */
export function SpaceBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
      <div className="space-glow absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_50%_0%,rgba(30,32,70,0.55),transparent_70%)]" />
      <div className="absolute -bottom-[25%] -right-[10%] h-[70%] w-[60%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(79,70,229,0.22),transparent_70%)] blur-3xl" />
      <div className="absolute -bottom-[30%] -left-[10%] h-[50%] w-[50%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(67,56,202,0.18),transparent_70%)] blur-3xl" />
      <Starfield count={60} className="opacity-60" />
      <FloorGrid className="h-[38%] opacity-60" />
    </div>
  );
}
