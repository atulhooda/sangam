import type { ReactNode } from "react";

/* Dark "terminal" frame, used for what the agent sees (steps 1–3). */
function Terminal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#23264a] bg-[#0b0d1a] shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-[#23264a] px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-[#f08a80]" />
        <span className="h-2 w-2 rounded-full bg-[#f0c062]" />
        <span className="h-2 w-2 rounded-full bg-[#6fd3a0]" />
        <span className="mono ml-2 text-[10px] text-[#8a8fa8]">{title}</span>
      </div>
      <pre className="mono overflow-x-auto p-4 text-[11.5px] leading-relaxed text-[#e6e9f5]">
        {children}
      </pre>
    </div>
  );
}

/* Light card, used for what Sangam does (steps 4–5). */
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</p>
      {children}
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: "ok" | "accent" | "muted" }) {
  const color = tone === "ok" ? "text-ok" : tone === "accent" ? "text-accent" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 last:border-0">
      <span className="text-xs text-muted">{k}</span>
      <span className={`mono text-right text-xs ${color}`}>{v}</span>
    </div>
  );
}

const K = ({ children }: { children: ReactNode }) => <span className="text-[#8a8fa8]">{children}</span>;
const B = ({ children }: { children: ReactNode }) => <span className="text-[#9bb8e0]">{children}</span>;
const Y = ({ children }: { children: ReactNode }) => <span className="text-[#f0c062]">{children}</span>;
const G = ({ children }: { children: ReactNode }) => <span className="text-[#6fd3a0]">{children}</span>;
const O = ({ children }: { children: ReactNode }) => <span className="text-[#a5b4fc]">{children}</span>;

const STEPS: {
  title: string;
  who: string;
  body: string;
  artifact: ReactNode;
}[] = [
  {
    title: "Discover",
    who: "customer-agent · ENSv2",
    body: "The agent looks up one name and gets everything it needs to buy. No signup, no API key, no sales call.",
    artifact: (
      <Terminal title="resolve tickets.sangam.eth">
        <O>tickets.sangam.eth</O>{"\n"}
        {"  "}<K>url   </K> /book{"\n"}
        {"  "}<K>price </K> <B>₹49 · 0.515391 USDC</B>{"\n"}
        {"  "}<K>payTo </K> 0.0.1002{"\n"}
        {"  "}<K>upi   </K> tickets@razorpay
      </Terminal>
    ),
  },
  {
    title: "Ask",
    who: "merchant-api",
    body: "It requests the ticket. Unpaid, the server replies 402 with a machine-readable invoice in a header.",
    artifact: (
      <Terminal title="GET /book">
        <O>→</O> GET /book?from=CSMT&amp;to=PUNE{"\n"}
        <Y>← 402 Payment Required</Y>{"\n"}
        {"  "}<K>PAYMENT-REQUIRED:</K> eyJ4NDAyVmVyc2lv…{"\n"}
        {"  "}<K>amount </K> <B>515391</B> <K>(0.515391 USDC)</K>{"\n"}
        {"  "}<K>payTo  </K> 0.0.1002 <K>· timeout 300s</K>
      </Terminal>
    ),
  },
  {
    title: "Pay",
    who: "x402 · Hedera",
    body: "It signs a USDC transfer for exactly that amount and retries. The ticket comes back. No human approved anything.",
    artifact: (
      <Terminal title="pay + retry">
        <K>sign </K> 0.515391 USDC <O>→</O> 0.0.1002{"\n"}
        <K>tx   </K> sim-0.0.1001@1793444010523.0{"\n"}
        <O>→</O> GET /book <K>+ X-PAYMENT</K>{"\n"}
        <G>← 200 OK</G> <K>ticket</K> CSMT → PUNE
      </Terminal>
    ),
  },
  {
    title: "Verify & decide",
    who: "settlement-agent · Mirror Node · 0G",
    body: "Sangam checks the transfer on Hedera itself, then a 0G model decides payout or hold, with a written reason.",
    artifact: (
      <Card title="Settlement · fdcea8b1">
        <Row k="Mirror Node" v="✓ transfer confirmed" tone="ok" />
        <Row k="Amount vs quote" v="515391 = 515391" />
        <Row k="0G decision" v="payout" tone="accent" />
        <p className="mt-3 rounded-lg bg-surface2 p-2.5 text-xs italic text-muted">
          &ldquo;Amount matches the quote and the payer looks normal.&rdquo;
        </p>
      </Card>
    ),
  },
  {
    title: "Settle & record",
    who: "RazorpayX · HCS",
    body: "USDC becomes rupees at the live rate and lands in the merchant's UPI account. The receipt goes on-ledger for good.",
    artifact: (
      <Card title="Payout · UPI">
        <Row k="FX" v="1 USDC = ₹95.07" tone="muted" />
        <Row k="Gross" v="₹49.00" />
        <Row k="Sangam fee (50 bps)" v="−₹0.25" tone="muted" />
        <Row k="To tickets@razorpay" v="₹48.75" tone="ok" />
        <Row k="HCS receipt" v="topic not set in sim" tone="muted" />
      </Card>
    ),
  },
];

export function FiveSteps() {
  return (
    <section id="how" className="relative border-y border-white/5 bg-white/[0.015] py-20">
      <div className="mx-auto max-w-6xl px-5">
        {/* Header */}
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            How it works
          </p>
          <h2 className="text-balance text-3xl font-medium tracking-[-0.035em] sm:text-5xl">
            One payment, five steps.
          </h2>
          <p className="mt-4 text-balance text-muted">
            A ₹49 rail ticket from CSMT to PUNE, bought by software. The values are from
            one simulated run.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs">
            <span className="rounded-full border border-line bg-surface px-3 py-1">
              <span className="font-semibold">0</span> <span className="text-muted">humans involved</span>
            </span>
            <span className="rounded-full border border-line bg-surface px-3 py-1">
              <span className="font-semibold">~4s</span> <span className="text-muted">notice to payout, sim run</span>
            </span>
            <span className="rounded-full border border-line bg-surface px-3 py-1">
              <span className="font-semibold">50 bps</span> <span className="text-muted">fee</span>
            </span>
          </div>
        </div>

        {/* Timeline */}
        <ol className="relative">
          {/* the rail: faint solid guide + flowing dots + a travelling "payment" */}
          <span aria-hidden className="absolute bottom-6 left-[15px] top-6 w-px bg-linear-to-b from-info via-accent to-ok opacity-25" />
          <span aria-hidden className="dot-rail absolute bottom-6 left-[14px] top-6 w-[3px]" />

          {STEPS.map((s, i) => (
            <li key={s.title} className="relative grid grid-cols-1 gap-5 pb-12 pl-12 last:pb-0 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-10">
              {/* the "payment" hops down the rail one step at a time: this step's
                  badge → the next step's badge, in its own 1.2s slot of a 6s cycle */}
              {i < STEPS.length - 1 && (
                <span aria-hidden className="absolute left-[15px] top-0 h-full w-0">
                  <span
                    className="rail-packet absolute -left-[5px] h-[11px] w-[11px] rounded-full bg-accent"
                    style={{ animationDelay: `${i * 1.2}s` }}
                  />
                </span>
              )}
              <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center">
                <span
                  aria-hidden
                  className="step-ripple absolute inset-0 rounded-full bg-accent"
                  style={{ animationDelay: `${i * 1.2}s` }}
                />
                <span className="relative flex h-8 w-8 items-center justify-center rounded-full border-4 border-surface2 bg-accent text-sm font-bold text-[#0b0b14]">
                  {i + 1}
                </span>
              </span>
              <div className="min-w-0">
                {/* Title row is 32px tall so its centre lines up with the number
                    badge and the card's title bar. On desktop a dotted line runs
                    from the end of the title, across the column gap (-mr-10 = the
                    40px gap), and stops exactly at the card's left edge. */}
                <div className="flex h-8 items-center gap-3">
                  <h3 className="shrink-0 text-xl font-semibold tracking-tight">{s.title}</h3>
                  <span aria-hidden className="relative -mr-10 hidden h-[3px] min-w-0 flex-1 md:block">
                    <span className="dot-link absolute inset-0" style={{ animationDelay: `${i * 0.15}s` }} />
                    {/* the "payment" running to the card, fired as the rail packet reaches this step */}
                    <span
                      className="link-packet absolute top-1/2 h-[9px] w-[9px] -translate-y-1/2 rounded-full bg-accent"
                      style={{ animationDelay: `${i * 1.2}s` }}
                    />
                  </span>
                </div>
                <p className="mono mt-1 text-[11px] text-accent">{s.who}</p>
                <p className="mt-3 max-w-sm text-muted">{s.body}</p>
              </div>
              <div className="relative min-w-0">
                {/* small joint where the line meets the card */}
                <span
                  aria-hidden
                  className="absolute -left-[4px] top-[12.5px] z-10 hidden h-2 w-2 rounded-full bg-accent ring-2 ring-surface2 md:block"
                />
                {s.artifact}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
