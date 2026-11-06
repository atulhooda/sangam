import { Backdrop } from "./components/backdrop";
import { ThemeToggle } from "./components/theme-toggle";
import { AccountMenu } from "./components/account-menu";
import { TwoWorlds } from "./components/two-worlds";
import { FiveSteps } from "./components/five-steps";
import { FourDepartments } from "./components/four-departments";

const STACK = [
  { name: "x402", note: "HTTP 402 paywalls — no checkout, no API key" },
  { name: "Hedera", note: "USDC settlement + HCS receipts" },
  { name: "0G Compute", note: "AI risk decision on every payment" },
  { name: "ENSv2", note: "Merchant discovery: tickets.sangam.eth" },
  { name: "UPI", note: "Rupee payout to the merchant's bank" },
];

export default function Home() {
  return (
    <main className="relative isolate">
      <Backdrop />

      {/* ── Nav ── */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <a href="/" className="flex items-baseline gap-2">
          <span className="text-xl font-bold tracking-tight text-accent">sangam</span>
          <span className="text-xs text-muted">/ संगम</span>
        </a>
        <div className="flex items-center gap-6 text-sm">
          <a href="#how" className="hidden text-muted hover:text-ink sm:block">How it works</a>
          <a href="#what" className="hidden text-muted hover:text-ink sm:block">What it is</a>
          <ThemeToggle />
          <AccountMenu />
          <a
            href="/dashboard"
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white transition-opacity hover:opacity-90"
          >
            Open dashboard →
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <header id="main" tabIndex={-1} className="mx-auto max-w-6xl scroll-mt-4 px-5 pt-16 pb-20 text-center outline-none sm:pt-24">
        <p className="mb-4 inline-block rounded-full bg-accentbg px-3 py-1 text-xs font-medium text-accent">
          Settlement rail for the agent economy
        </p>
        <h1 className="display mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
          Agents pay in <span className="text-accent">USDC</span>.
          <br />
          Merchants get <span className="text-accent">rupees</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
          An AI agent buys from an Indian merchant&apos;s API over x402 on Hedera. Sangam
          verifies the payment on-chain, decides with 0G Compute, pays the merchant in
          INR over UPI, and writes a receipt to an immutable ledger.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/dashboard"
            className="rounded-lg bg-accent px-6 py-3 font-medium text-white transition-opacity hover:opacity-90"
          >
            Watch a payment settle live
          </a>
          <a
            href="#how"
            className="rounded-lg border border-line bg-surface px-6 py-3 font-medium transition-colors hover:border-accent"
          >
            How it works
          </a>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {STACK.map((s) => (
            <span
              key={s.name}
              title={s.note}
              className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted"
            >
              {s.name}
            </span>
          ))}
        </div>
      </header>

      {/* ── The gap ── */}
      <TwoWorlds />

      {/* ── How it works ── */}
      <FiveSteps />

      {/* ── What Sangam is ── */}
      <FourDepartments />

      {/* ── Footer ── */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted">
          <p>
            sangam — built on <span className="text-ink">Hedera</span>,{" "}
            <span className="text-ink">0G</span> and <span className="text-ink">ENSv2</span>
          </p>
          <div className="flex gap-5">
            <a href="/dashboard" className="hover:text-ink">Dashboard</a>
            <a href="https://ethglobal.com/events/mumbai" className="hover:text-ink">ETHGlobal Mumbai</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
