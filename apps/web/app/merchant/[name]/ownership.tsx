"use client";

import { useEffect, useState } from "react";
import type { Me } from "@/lib/types";
import { ownershipMessage } from "@/lib/ownership-link";
import { connectWallet, injected, walletError } from "@/lib/wallet-client";
import { Card, CardHead, LedgerRow, Spinner } from "../../components/ui";

/*
 * The merchant takes ownership of its ENS name with its own wallet. After
 * that, only that wallet can change the shop's prices, UPI handle and payout
 * addresses; Sangam keeps exactly one right, the verified stamp.
 */

type Job = { state: "running" | "done" | "failed"; log: string[]; error: string | null };
const etherscan = (a: string) => `https://sepolia.etherscan.io/address/${a}`;

export function OwnershipCard({ me, onChange }: { me: Me; onChange: (me: Me) => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owned = me.shop?.owned ?? null;

  // While the handover runs, poll it; when it's done the profile carries `owned`.
  useEffect(() => {
    if (job?.state !== "running") return;
    const t = setInterval(async () => {
      const body = (await (await fetch("/api/merchant/ownership", { cache: "no-store" })).json()) as { job: Job | null; me?: Me };
      if (body.job) setJob(body.job);
      if (body.job?.state === "done" && body.me) onChange(body.me);
    }, 3000);
    return () => clearInterval(t);
  }, [job?.state, onChange]);

  async function take() {
    setBusy(true);
    setError(null);
    try {
      const provider = injected();
      if (!provider) throw new Error("No wallet in this browser. Install MetaMask, then try again.");
      const address = await connectWallet(provider);
      const issuedAt = new Date().toISOString();
      const signature = await provider.request({ method: "personal_sign", params: [ownershipMessage(me.label, address, issuedAt), address] });
      const res = await fetch("/api/merchant/ownership", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, issuedAt, signature }) });
      const body = (await res.json()) as { job?: Job; error?: string };
      if (!res.ok || !body.job) throw new Error(body.error ?? `Could not start (${res.status})`);
      setJob(body.job);
    } catch (err) {
      setError(walletError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead
        title="Own your name"
        hint="Your ENS name, your prices, your payout details. Not Sangam's."
        right={
          owned ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2 py-0.5 text-[11px] font-medium text-ok">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" /> owned by your wallet
            </span>
          ) : null
        }
      />
      <div className="space-y-3 px-5 py-4 text-sm">
        {owned ? (
          <>
            <div className="rounded-lg bg-surface2 px-3 py-1">
              <LedgerRow
                k="Owner (your wallet)"
                v={
                  <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={etherscan(owned.owner)} target="_blank" rel="noreferrer" title={owned.owner}>
                    {owned.owner.slice(0, 10)}…{owned.owner.slice(-6)} ↗
                  </a>
                }
              />
              <LedgerRow
                k="Your own resolver"
                v={
                  <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={etherscan(owned.resolver)} target="_blank" rel="noreferrer" title={owned.resolver}>
                    {owned.resolver.slice(0, 10)}…{owned.resolver.slice(-6)} ↗
                  </a>
                }
              />
              <LedgerRow
                k="In the ENS app"
                v={
                  <a className="mono text-xs text-accent underline-offset-2 hover:underline" href={`https://sepolia.app.ens.domains/${me.label}`} target="_blank" rel="noreferrer">
                    {me.label} ↗
                  </a>
                }
              />
            </div>
            <ul className="space-y-1 text-xs">
              <li>
                <span className="font-medium text-ok">Only you</span> can change your prices, UPI handle, payout addresses and products. Each change is signed in your wallet.
              </li>
              <li>
                <span className="font-medium">Sangam</span> can only add or remove your <span className="mono">verified</span> stamp. It can&apos;t redirect your money, even if it&apos;s hacked.
              </li>
              <li className="text-muted">Sangam still owns sangam.eth, the name above yours; locking that is a one-time step at launch.</li>
            </ul>
          </>
        ) : job?.state === "running" ? (
          <div>
            <p className="flex items-center gap-2 font-medium">
              <Spinner className="h-3.5 w-3.5" /> Handing {me.label} to your wallet… (about a minute)
            </p>
            <ol className="mono mt-2 space-y-0.5 text-[11px] text-muted">
              {job.log.slice(-6).map((l, i) => (
                <li key={i} className="truncate">
                  {l}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <>
            <p className="text-muted">
              Right now Sangam holds <span className="mono text-ink">{me.label}</span> for you. Take ownership and the name moves to your own wallet: from then on{" "}
              <span className="text-ink">only you can change where your money goes</span>, and Sangam can only vouch for you.
            </p>
            <p className="rounded-lg bg-warnbg/70 px-3 py-2 text-xs">
              Keep that wallet safe: after this, every price or payout change needs it, and Sangam can&apos;t change them for you. You&apos;ll need a little Sepolia ETH for your own
              edits.
            </p>
            <button
              onClick={take}
              disabled={busy}
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]"
            >
              {busy ? "Check your wallet…" : "Take ownership with MetaMask"}
            </button>
          </>
        )}
        {(error || job?.state === "failed") && (
          <p role="alert" className="rounded-lg bg-badbg px-3 py-2 text-xs text-bad">
            {error ?? job?.error}
          </p>
        )}
      </div>
    </Card>
  );
}
