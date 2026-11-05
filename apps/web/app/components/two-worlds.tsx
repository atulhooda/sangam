const OLD_WAY = [
  { step: "Create an account", why: "needs an email and a human" },
  { step: "Pass KYC", why: "needs a legal entity" },
  { step: "Add a card", why: "agents don't have one" },
  { step: "Prepay or subscribe", why: "overpay, or run out mid-task" },
  { step: "Get invoiced in ₹", why: "the agent holds USDC" },
  { step: "Reconcile by hand", why: "days, not seconds" },
];

const NEW_WAY = [
  { step: "Request", why: "the server answers 402 with an invoice" },
  { step: "Pay in USDC", why: "settled on Hedera in seconds" },
  { step: "Merchant gets ₹", why: "UPI payout, receipt on HCS" },
];

function Friction({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 flex flex-wrap gap-1.5">
      {items.map((t) => (
        <li
          key={t}
          className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted"
        >
          <span className="text-bad">✕</span> {t}
        </li>
      ))}
    </ul>
  );
}

/** Agent side: a terminal showing what the agent actually sees. */
function AgentCard() {
  return (
    <div>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-info">
        River one · USDC on Hedera
      </p>
      <h3 className="mb-4 text-xl font-semibold tracking-tight">An agent with money</h3>
      <div className="overflow-hidden rounded-xl border border-[#33312c] bg-[#1a1917] shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-[#33312c] px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-[#f08a80]" />
          <span className="h-2 w-2 rounded-full bg-[#f0c062]" />
          <span className="h-2 w-2 rounded-full bg-[#6fd3a0]" />
          <span className="mono ml-2 text-[10px] text-[#a19c93]">customer-agent</span>
        </div>
        <pre className="mono overflow-x-auto p-4 text-[11.5px] leading-relaxed text-[#ece9e2]">
          <span className="text-[#a19c93]">wallet </span> 0.0.1001{"\n"}
          <span className="text-[#a19c93]">balance</span> <span className="text-[#9bb8e0]">42.50 USDC</span>{"\n\n"}
          <span className="text-[#e98a4f]">→</span> GET /book?from=CSMT&amp;to=PUNE{"\n"}
          <span className="text-[#f0c062]">← 402 Payment Required</span>
        </pre>
      </div>
      <Friction items={["no card", "no OTP", "no bank account"]} />
    </div>
  );
}

/** Merchant side: the UPI credit notification the merchant actually sees. */
function MerchantCard() {
  return (
    <div>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ok">
        River two · Rupees over UPI
      </p>
      <h3 className="mb-4 text-xl font-semibold tracking-tight">A merchant with an API</h3>
      <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-[11px] font-medium text-muted">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-okbg text-[10px] font-bold text-ok">
              ₹
            </span>
            UPI · tickets@razorpay
          </span>
          <span className="text-[10px] text-muted">just now</span>
        </div>
        <p className="text-2xl font-bold tracking-tight">
          ₹48.75 <span className="text-sm font-medium text-ok">credited</span>
        </p>
        <p className="mono mt-1 text-[11px] text-muted">from Sangam · rail ticket CSMT → PUNE</p>
      </div>
      <Friction items={["no wallet", "no chain node", "no crypto risk"]} />
    </div>
  );
}

/** The confluence: USDC stream in, Sangam node, rupee stream out. */
function Confluence({ vertical = false }: { vertical?: boolean }) {
  if (vertical) {
    return (
      <div className="flex flex-col items-center py-2" aria-hidden>
        <svg width="24" height="56" viewBox="0 0 24 56">
          <line x1="12" y1="0" x2="12" y2="56" className="flow-line stroke-info" strokeWidth="2" />
        </svg>
        <SangamNode />
        <svg width="24" height="56" viewBox="0 0 24 56">
          <line x1="12" y1="0" x2="12" y2="56" className="flow-line stroke-ok" strokeWidth="2" />
        </svg>
      </div>
    );
  }
  return (
    <div className="flex items-center" aria-hidden>
      <div className="flex flex-col items-center">
        <span className="mono mb-1 text-[10px] text-info">0.515 USDC</span>
        <svg width="72" height="8" viewBox="0 0 72 8">
          <line x1="0" y1="4" x2="72" y2="4" className="flow-line stroke-info" strokeWidth="2" />
        </svg>
      </div>
      <SangamNode />
      <div className="flex flex-col items-center">
        <span className="mono mb-1 text-[10px] text-ok">₹48.75</span>
        <svg width="72" height="8" viewBox="0 0 72 8">
          <line x1="0" y1="4" x2="72" y2="4" className="flow-line stroke-ok" strokeWidth="2" />
        </svg>
      </div>
    </div>
  );
}

function SangamNode() {
  return (
    <div className="relative mx-1 flex flex-col items-center">
      <span className="pulse-ring absolute inset-0 rounded-2xl bg-accent/20" />
      <div className="relative rounded-2xl border border-accent/40 bg-accentbg px-4 py-3 text-center">
        <p className="text-sm font-bold text-accent">sangam</p>
        <p className="mono mt-0.5 text-[9.5px] text-muted">verify · decide · settle</p>
      </div>
    </div>
  );
}

export function TwoWorlds() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      {/* Header */}
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
          The problem
        </p>
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-5xl">
          Two worlds that can&apos;t pay each other.
        </h2>
        <p className="mt-4 text-muted">
          <span className="font-medium text-ink">संगम</span>{" "}
          <span className="italic">(sangam)</span> is the confluence, the place where two
          rivers meet. Here are the two rivers.
        </p>
      </div>

      {/* The confluence panel */}
      <div className="dot-grid relative rounded-3xl border border-line bg-surface2 p-6 sm:p-10">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-4">
          <AgentCard />
          <div className="hidden self-center lg:block">
            <Confluence />
          </div>
          <div className="lg:hidden">
            <Confluence vertical />
          </div>
          <MerchantCard />
        </div>
      </div>

      {/* Old way vs with Sangam */}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
          <div className="mb-5 flex items-baseline justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              The old way
            </h3>
            <span className="mono text-[11px] text-bad">{OLD_WAY.length} steps · blocked at 1</span>
          </div>
          <ol className="space-y-3">
            {OLD_WAY.map((s, i) => (
              <li key={s.step} className="flex gap-3">
                <span className="mono mt-0.5 w-4 shrink-0 text-xs text-muted">{i + 1}</span>
                <p className="text-sm">
                  <span className="text-muted line-through decoration-bad/50">{s.step}</span>
                  <span className="text-muted"> → {s.why}</span>
                </p>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-3xl border border-accent/40 bg-accentbg p-6 sm:p-8">
          <div className="mb-5 flex items-baseline justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              With Sangam
            </h3>
            <span className="mono text-[11px] text-ok">{NEW_WAY.length} steps · no human</span>
          </div>
          <ol className="space-y-5">
            {NEW_WAY.map((s, i) => (
              <li key={s.step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                  {i + 1}
                </span>
                <p>
                  <span className="font-semibold">{s.step}</span>
                  <span className="block text-sm text-muted">{s.why}</span>
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Closing line */}
      <p className="mx-auto mt-14 max-w-3xl text-balance text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        The APIs exist. The money exists.{" "}
        <span className="text-accent">Sangam is where they meet.</span>
      </p>
    </section>
  );
}
