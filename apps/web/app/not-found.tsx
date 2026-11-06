import Link from "next/link";
import { Logo } from "./components/space/kit";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col">
      <div aria-hidden className="hero-grid pointer-events-none absolute inset-x-0 top-0 h-[700px]" />
      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/" aria-label="Sangam home"><Logo /></Link>
      </header>

      <main id="main" className="relative mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-5 pb-24 text-center">
        <div className="mb-8 w-full dark overflow-hidden rounded-xl border border-[#23264a] bg-[#0b0d1a] text-left shadow-sm">
          <div className="flex items-center gap-1.5 border-b border-[#23264a] px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-[#f08a80]" />
            <span className="h-2 w-2 rounded-full bg-[#f0c062]" />
            <span className="h-2 w-2 rounded-full bg-[#6fd3a0]" />
            <span className="mono ml-2 text-[10px] text-[#8a8fa8]">agent</span>
          </div>
          <pre className="mono overflow-x-auto p-4 text-[12px] leading-relaxed text-[#e6e9f5]">
            <span className="text-[#a5b4fc]">→</span> GET this page{"\n"}
            <span className="text-[#f08a80]">← 404 Not Found</span>{"\n"}
            <span className="text-[#8a8fa8]">{"  "}not a 402: there&apos;s nothing to pay for here</span>
          </pre>
        </div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">404</p>
        <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">This page doesn&apos;t exist.</h1>
        <p className="mt-3 text-balance text-muted">
          The link may be wrong, or the page may have moved.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="rounded-full bg-accent px-5 py-2.5 font-medium text-white transition-opacity hover:opacity-90 dark:text-[#0b0d1a]">
            Back to home
          </Link>
          <Link href="/dashboard" className="rounded-full border border-white/10 bg-white/[0.05] px-5 py-2.5 font-medium transition-colors hover:border-accent">
            Open dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
