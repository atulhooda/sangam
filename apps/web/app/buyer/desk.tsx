"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Me, Settlement } from "@/lib/types";
import { AgentRunOverlay, runPayAsAgent, useAgentRun } from "../components/agent-run";
import { Card, CardHead, MockTag, RailBadge, RailToggle, Spinner, StatusPill, idBadge, useRail } from "../components/ui";
import { Logo } from "../components/space/kit";
import { MetaMaskCard, type MetaMaskView } from "./metamask";
import { AccountMenu } from "../components/account-menu";
import { BoloAgent } from "../components/bolo-agent";
import { BargainButton } from "./bargain";
import { RAIL_NAME, clock, explorerName, explorerTx, settlementTxUrl, isSimTx, railOf, receiptLink, rupees, timeAgo, tokenOf, usdc } from "../dashboard/format";

/*
 * The buyer desk: the buyer's AI agent and everything it pays for.
 *
 *   1. Agent wallet  the buyer's own Hedera account, created by Sangam and
 *                    funded from the demo faucet or any wallet
 *   2. Merchants     every Sangam merchant, read from ENS (price, verified)
 *   3. Run agent     the agent pays each chosen merchant over x402, from the
 *                    buyer's wallet into the merchant's own account, after
 *                    checking the merchant against ENS
 *   4. Transactions  each payment, step by step: Hedera → chain check →
 *                    0G decision → UPI payout → HCS receipt
 *
 * page.tsx lets in only buyers signed in with Self.
 */

type WalletView = {
  wallet: { accountId: string; createdAt: string; fundedAtomic: string } | null;
  balanceAtomic?: string | null;
  spentAtomic?: string;
  limitAtomic?: string;
  remainingAtomic?: string;
  faucetLeftAtomic?: string;
  error?: string;
};

type Merchant = {
  ensName: string;
  url?: string;
  priceInrPaise?: number;
  priceUsdcAtomic?: string;
  /** ± haggling band published on ENS, in bps of the price. */
  bargainBps?: number | null;
  payTo?: string;
  upiHandle?: string;
  status?: string | null;
  verified?: boolean;
  ownAccount?: boolean;
  error?: string;
};

type RunLine = { ensName: string; state: "queued" | "paying" | "paid" | "refused" | "failed"; text: string; href?: string };

const hashscanAccount = (id: string) => `https://hashscan.io/testnet/account/${id}`;

export function BuyerDesk({ me }: { me: Me }) {
  const agentRun = useAgentRun();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [run, setRun] = useState<RunLine[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<"connect" | "fund" | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; href?: string } | null>(null);
  const [denied, setDenied] = useState(false);
  const badge = idBadge(me.attestationId);
  const [railPref, setRail] = useRail();
  const [metamask, setMetamask] = useState<MetaMaskView | null>(null);
  const onMetamask = useCallback((v: MetaMaskView | null) => setMetamask(v), []);

  // Sent here from a merchant desk? Say why.
  useEffect(() => {
    setDenied(new URLSearchParams(window.location.search).get("denied") === "merchant");
  }, []);

  const loadWallet = useCallback(async () => {
    try {
      setWallet((await (await fetch("/api/buyer/wallet", { cache: "no-store" })).json()) as WalletView);
    } catch {
      /* keep the last view */
    }
  }, []);

  useEffect(() => {
    void loadWallet();
    fetch("/api/merchants", { cache: "no-store" })
      .then((r) => r.json() as Promise<Merchant[]>)
      .then((rows) => {
        setMerchants(rows);
        setPicked(new Set(rows.filter((m) => m.verified).map((m) => m.ensName)));
      })
      .catch(() => setMerchants([]));
  }, [loadWallet]);

  // Live transactions: every settlement this wallet paid, refreshed every 2 s.
  const accountId = wallet?.wallet?.accountId ?? null;
  const mmAddress = metamask?.address?.toLowerCase() ?? null;
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    const tick = async () => {
      try {
        const rows = (await (await fetch("/api/settlements", { cache: "no-store" })).json()) as Settlement[];
        if (alive) setSettlements(rows.filter((s) => s.payer === accountId || (!!mmAddress && s.payer?.toLowerCase() === mmAddress)));
      } catch {
        /* next tick */
      }
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [accountId, mmAddress]);

  async function connect() {
    setBusy("connect");
    setNotice(null);
    try {
      const res = await fetch("/api/buyer/wallet", { method: "POST" });
      const body = (await res.json()) as WalletView;
      if (!res.ok) setNotice({ ok: false, text: body.error ?? `Failed (${res.status})` });
      else setWallet(body);
    } finally {
      setBusy(null);
    }
  }

  async function fund() {
    setBusy("fund");
    setNotice(null);
    try {
      const res = await fetch("/api/buyer/fund", { method: "POST" });
      const body = (await res.json()) as { error?: string; amountAtomic?: string; hashscan?: string };
      setNotice(res.ok ? { ok: true, text: `Added ${usdc(body.amountAtomic ?? "0", 2)} test USDC to your agent wallet.`, href: body.hashscan } : { ok: false, text: body.error ?? `Failed (${res.status})` });
      await loadWallet();
    } finally {
      setBusy(null);
    }
  }

  async function runAgent(names: string[]) {
    if (names.length === 0) return;
    setRunning(true);
    setNotice(null);
    setRun(names.map((ensName) => ({ ensName, state: "queued", text: "waiting" })));
    const set = (ensName: string, line: Omit<RunLine, "ensName">) => setRun((rs) => rs.map((r) => (r.ensName === ensName ? { ensName, ...line } : r)));
    for (const ensName of names) {
      set(ensName, { state: "paying", text: `checking ENS, ${rail === "sepolia" ? "paying USDC from your MetaMask" : "reading the 402 invoice, signing USDC on Hedera"}…` });
      const { verdict, body } = await runPayAsAgent(
        agentRun.run,
        { title: "Buying as your agent", target: ensName },
        { ensName, rail },
        "/api/agent/buy",
      );
      if (verdict.kind === "refused") set(ensName, { state: "refused", text: `🛡️ refused, nothing signed: ${verdict.message}` });
      else if (verdict.kind === "paid")
        set(ensName, {
          state: "paid",
          text: `paid ${usdc(String(body?.priceAtomic ?? "0"), 2)} USDC → ${String(body?.payTo ?? "merchant")} · ${String(body?.hederaTxId ?? "")}`,
          href: verdict.hashscan,
        });
      else set(ensName, { state: "failed", text: verdict.message });
      await loadWallet();
    }
    setRunning(false);
  }

  const byName = useMemo(() => new Map((merchants ?? []).map((m) => [m.ensName, m])), [merchants]);
  const rows = settlements ?? [];
  const w = wallet?.wallet ?? null;
  const rails: ("hedera" | "sepolia")[] = ["hedera", ...(metamask?.address ? (["sepolia"] as const) : [])];
  const rail = rails.includes(railPref) ? railPref : "hedera";
  const verified = (merchants ?? []).filter((m) => m.verified);
  const pickedList = verified.filter((m) => picked.has(m.ensName)).map((m) => m.ensName);
  const pickedCost = verified.filter((m) => picked.has(m.ensName)).reduce((s, m) => s + BigInt(m.priceUsdcAtomic ?? "0"), 0n);
  const toggle = (n: string) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    return next;
  });

  return (
    <div className="min-h-screen">
      <header className="space-bar sticky top-3 z-40">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <a href="/" aria-label="Sangam home"><Logo /></a>
            <span className="text-line">/</span>
            <span className="text-sm font-medium">Buyer desk</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="hidden rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink sm:block">
              Settlement desk →
            </a>
            <AccountMenu me={me} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-5 py-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Your shopping agent</h1>
            <p className="mt-1 text-sm text-muted">It pays merchants in USDC on Hedera, with no approval step. They get rupees on UPI.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-3 py-1 text-xs font-medium text-ok" title={`Verified via Self${me.name ? ` — ${me.name}` : ""}`}>
            {badge.label} verified
          </span>
        </div>

        {denied && (
          <p className="rounded-2xl border border-warn/30 bg-warnbg/60 px-5 py-4 text-sm" role="status">
            <span className="font-semibold">Merchant desks are for merchants.</span>{" "}
            <span className="text-muted">You're signed in as a buyer. To run a merchant desk, sign in as a merchant with your company certificate.</span>
          </p>
        )}

        {notice && (
          <p className={`rounded-xl p-3 text-sm ${notice.ok ? "bg-okbg text-ok" : "bg-badbg text-bad"}`} role="status">
            {notice.text}
            {notice.href && (
              <>
                {" · "}
                <a className="underline-offset-2 hover:underline" href={notice.href} target="_blank" rel="noreferrer">{explorerName(notice.href)} ↗</a>
              </>
            )}
          </p>
        )}

        {/* ── 1. agent wallet ── */}
        <Card>
          <CardHead title="1 · Agent wallet" hint="Your agent's own Hedera account. It pays from here; you never approve a transaction." />
          {wallet === null ? (
            <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted"><Spinner /> Loading…</p>
          ) : !w ? (
            <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted">Connect a wallet for your agent: Sangam opens a USDC-enabled Hedera testnet account in your name. Takes a few seconds.</p>
              <button
                onClick={connect}
                disabled={busy !== null}
                className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]"
              >
                {busy === "connect" ? "Creating account…" : "Connect agent wallet"}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted">Account</p>
                <a className="mono mt-1 block text-sm text-accent underline-offset-2 hover:underline" href={hashscanAccount(w.accountId)} target="_blank" rel="noreferrer">
                  {w.accountId} ↗
                </a>
                <p className="mt-1 text-[11px] text-muted">Send testnet USDC here from any wallet to top up.</p>
              </div>
              <div>
                <p className="text-xs text-muted">Balance</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">{wallet.balanceAtomic == null ? "—" : usdc(wallet.balanceAtomic, 2)} <span className="text-sm font-normal text-muted">USDC</span></p>
                <button
                  onClick={() => fund()}
                  disabled={busy !== null || wallet.faucetLeftAtomic === "0"}
                  className="mt-2 rounded-lg border border-accent/50 bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:border-accent disabled:opacity-50"
                  title={wallet.faucetLeftAtomic === "0" ? "Free test USDC used up" : undefined}
                >
                  {busy === "fund" ? "Sending…" : wallet.faucetLeftAtomic === "0" ? "Faucet used up" : "+ Add test USDC"}
                </button>
              </div>
              <div>
                <p className="text-xs text-muted">Agent budget left</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">{usdc(wallet.remainingAtomic ?? "0", 2)} <span className="text-sm font-normal text-muted">of {usdc(wallet.limitAtomic ?? "0", 2)}</span></p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-500"
                    style={{ width: `${Math.min(100, (Number(wallet.remainingAtomic ?? 0) / Math.max(1, Number(wallet.limitAtomic ?? 1))) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </Card>

        {w && <MetaMaskCard onChange={onMetamask} />}

        {/* ── 2 + 3. merchants and the agent ── */}
        <Card>
          <CardHead
            title="2 · Merchants"
            hint="Read live from ENS. The agent pays only verified merchants, to the account in their ENS record."
            right={<span className="text-xs text-muted">{verified.length} verified</span>}
          />
          {merchants === null ? (
            <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted"><Spinner /> Reading ENS…</p>
          ) : (
            <ul className="divide-y divide-line">
              {merchants.map((m) => (
                <li key={m.ensName} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Include ${m.ensName}`}
                    checked={picked.has(m.ensName) && !!m.verified}
                    disabled={!m.verified || running}
                    onChange={() => toggle(m.ensName)}
                    className="h-4 w-4 accent-[var(--color-accent,#b5541c)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="mono truncate text-sm font-medium">{m.ensName}</p>
                    {m.error ? (
                      <p className="text-xs text-bad">{m.error}</p>
                    ) : (
                      <p className="truncate text-xs text-muted">
                        pays <span className="mono">{m.payTo}</span>
                        {m.ownAccount ? " (its own account)" : " (Sangam treasury)"} · UPI <span className="mono">{m.upiHandle}</span>
                      </p>
                    )}
                  </div>
                  {!m.error && (
                    <>
                      <span className="text-sm tabular-nums">
                        {rupees(m.priceInrPaise ?? 0)}
                        {typeof m.bargainBps === "number" && m.bargainBps > 0 && (
                          <span className="text-xs text-muted" title="The merchant's published haggling band on ENS — a bargained deal always lands inside it">
                            {" "}± {rupees(Math.round(((m.priceInrPaise ?? 0) * m.bargainBps) / 10_000))}
                          </span>
                        )}{" "}
                        <span className="text-xs text-muted">≈ {usdc(m.priceUsdcAtomic ?? "0", 2)} USDC</span>
                      </span>
                      {m.verified ? (
                        <span className="rounded-full bg-okbg px-2 py-0.5 text-[11px] font-medium text-ok">verified</span>
                      ) : (
                        <span className="rounded-full bg-warnbg px-2 py-0.5 text-[11px] font-medium text-warn">{m.status ?? "unverified"}</span>
                      )}
                      <BargainButton ensName={m.ensName} rail={rail} disabled={!w || running || !m.verified} onDone={() => void loadWallet()} />
                      <button
                        onClick={() => runAgent([m.ensName])}
                        disabled={!w || running || !m.verified}
                        className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-medium transition-colors hover:border-accent disabled:opacity-50"
                      >
                        Buy
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-muted">
                {w ? `Selected ${pickedList.length} · about ${usdc(pickedCost.toString(), 2)} USDC` : "Connect your agent wallet to start buying."}
              </p>
              <RailToggle rail={rail} onChange={setRail} rails={rails} />
            </div>
            <button
              onClick={() => runAgent(pickedList)}
              disabled={!w || running || pickedList.length === 0}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]"
            >
              {running ? "Agent is paying…" : `3 · Run agent on ${pickedList.length} merchant${pickedList.length === 1 ? "" : "s"} →`}
            </button>
          </div>
          {run.length > 0 && (
            <ol className="space-y-1.5 border-t border-line px-5 py-4 text-xs">
              {run.map((r) => (
                <li key={r.ensName} className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 shrink-0">
                    {r.state === "paying" ? <Spinner className="h-3 w-3" /> : r.state === "paid" ? "✓" : r.state === "refused" ? "🛡️" : r.state === "failed" ? "✕" : "·"}
                  </span>
                  <span className="mono shrink-0 font-medium">{r.ensName}</span>
                  <span className={`min-w-0 break-words ${r.state === "failed" ? "text-bad" : r.state === "paid" ? "text-ok" : "text-muted"}`}>
                    {r.text}
                    {r.href && (
                      <>
                        {" "}
                        <a className="text-accent underline-offset-2 hover:underline" href={r.href} target="_blank" rel="noreferrer">{explorerName(r.href)} ↗</a>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* ── bolo: pay by voice — the floating robot is mounted at the desk root ── */}

        {/* ── 4. live transactions ── */}
        <Card>
          <CardHead title="4 · Transactions" hint="Live: your wallet → the merchant's account → rupees on the merchant's UPI." right={<span className="text-xs text-muted">{rows.length} total</span>} />
          {!w ? (
            <p className="px-5 py-8 text-sm text-muted">No wallet yet.</p>
          ) : settlements === null ? (
            <p className="flex items-center gap-2 px-5 py-8 text-sm text-muted"><Spinner /> Loading…</p>
          ) : rows.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="font-medium">Nothing bought yet</p>
              <p className="mt-1 text-sm text-muted">Fund the wallet, pick merchants and run the agent. Each payment appears here as it settles.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((s) => (
                <Txn key={s.id} s={s} from={w.accountId} merchant={byName.get(s.merchant)} />
              ))}
            </ul>
          )}
        </Card>
      </main>
      <AgentRunOverlay state={agentRun.state} onClose={agentRun.close} />
      <BoloAgent
        role="buyer"
        targets={verified.map((m) => ({ ensName: m.ensName, priceInrPaise: m.priceInrPaise }))}
        rail={rail}
        onDone={() => void loadWallet()}
      />
    </div>
  );
}

/** One payment, step by step. */
function Txn({ s, from, merchant }: { s: Settlement; from: string; merchant?: Merchant }) {
  const failed = s.status === "failed";
  const steps: { label: string; done: boolean; detail: React.ReactNode }[] = [
    {
      label: `Paid on ${RAIL_NAME[railOf(s)]}`,
      done: true,
      detail: isSimTx(s.hederaTxId) ? (
        <MockTag>simulated</MockTag>
      ) : (
        <a className="mono text-accent underline-offset-2 hover:underline" href={settlementTxUrl(s)} target="_blank" rel="noreferrer">
          {s.hederaTxId.slice(0, 18)}… ↗
        </a>
      ),
    },
    ...(s.initiator === "agent"
      ? [
          {
            label: "Signed by AI agent",
            done: true,
            detail: (
              <>
                {s.agentMethod === "erc20-allowance" ? "transferFrom under your allowance" : "x402 signed transfer"}
                {s.agent ? <> · <span className="mono">{s.agent.length > 20 ? `${s.agent.slice(0, 10)}…${s.agent.slice(-4)}` : s.agent}</span></> : null}
              </>
            ),
          },
        ]
      : []),
    { label: "Verified on chain", done: !!s.chainVerified, detail: s.chainVerified ? "Mirror Node: USDC landed" : s.status === "received" ? "checking…" : "skipped" },
    {
      label: "0G decision",
      done: !!s.decision,
      detail: s.decision ? `${s.decision}${s.feeBps !== null ? ` · fee ${(s.feeBps / 100).toFixed(2)}%` : ""}` : "…",
    },
    {
      label: "UPI payout",
      done: s.status === "paid",
      detail: s.status === "paid" ? <>{rupees(s.payoutPaise ?? 0)} · <span className="mono">{s.payoutRef}</span>{s.payoutMode === "mock" && <MockTag>mock</MockTag>}</> : s.status === "held" ? `held, USDC refund scheduled` : "…",
    },
    {
      label: "HCS receipt",
      done: s.hcsSequence !== null,
      detail: (() => {
        const r = receiptLink(s);
        return r ? (
          <a className="mono text-accent underline-offset-2 hover:underline" href={r.href} target="_blank" rel="noreferrer">
            #{s.hcsSequence} ↗
          </a>
        ) : (
          "…"
        );
      })(),
    },
  ];
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="mono flex items-center gap-2 truncate text-sm font-medium">{s.merchant} <RailBadge s={s} /></p>
          <p className="text-xs text-muted">
            <span className="tabular-nums">{clock(s.createdAt)}</span> · {timeAgo(s.createdAt, Date.now())} · {usdc(s.usdcAmount, 2)} {tokenOf(s)}
            {s.inrGrossPaise ? ` ≈ ${rupees(s.inrGrossPaise)}` : ""}
          </p>
        </div>
        <StatusPill s={s} />
      </div>
      <p className="mono mt-2 truncate text-[11px] text-muted">
        {railOf(s) === "sepolia"
          ? `${(s.payer ?? from).slice(0, 10)}… (your wallet) → ${s.merchant} deposit → ${merchant?.upiHandle ?? "UPI"}`
          : `${from} → ${merchant?.payTo ?? "merchant"} → ${merchant?.upiHandle ?? "UPI"}`}
      </p>
      <ol className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-5">
        {steps.map((st) => (
          <li key={st.label} className={`rounded-lg px-2.5 py-2 text-[11px] ${st.done ? "bg-okbg/60" : failed ? "bg-badbg/60" : "bg-surface2"}`}>
            <p className={`font-semibold ${st.done ? "text-ok" : "text-muted"}`}>{st.done ? "✓ " : ""}{st.label}</p>
            <div className="mt-0.5 break-words text-muted">{st.detail}</div>
          </li>
        ))}
      </ol>
      {s.error && <p className="mt-2 text-xs text-bad">{s.error}</p>}
    </li>
  );
}
