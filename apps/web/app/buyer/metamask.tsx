"use client";

import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { Card, CardHead, Spinner } from "../components/ui";
import { usdc } from "../dashboard/format";
import { SEPOLIA_USDC, linkMessage } from "@/lib/wallet-link";
import { connectWallet, injected as eth, sendAndWait, walletError, type Eth } from "@/lib/wallet-client";

/*
 * The buyer's own MetaMask, for agent payments on Sepolia. Link once (a
 * signature proves the wallet is yours), approve a spending limit once (a USDC
 * allowance for your agent, enforced by the token contract and revocable in
 * MetaMask), and from then on the agent pays shops by their ENS name from your
 * wallet with no pop-ups.
 */

export type MetaMaskView = {
  agent: string;
  address: string | null;
  balanceAtomic?: string | null;
  allowanceAtomic?: string | null;
  explorer?: string;
  error?: string;
};

export function MetaMaskCard({ onChange }: { onChange: (v: MetaMaskView | null) => void }) {
  const [view, setView] = useState<MetaMaskView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState("10");

  const load = useCallback(async () => {
    try {
      const v = (await (await fetch("/api/buyer/metamask", { cache: "no-store" })).json()) as MetaMaskView;
      setView(v);
      onChange(v);
    } catch {
      /* keep the last view */
    }
  }, [onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, fn: (provider: Eth) => Promise<void>) {
    const provider = eth();
    if (!provider) return setError("No wallet found in this browser. Install MetaMask (or any EVM wallet) and reload.");
    setBusy(label);
    setError(null);
    try {
      await fn(provider);
      await load();
    } catch (err) {
      setError(walletError(err));
    } finally {
      setBusy(null);
    }
  }

  const connect = () =>
    run("connect", async (provider) => {
      if (!view) throw new Error("Still loading; try again.");
      const address = await connectWallet(provider);
      const issuedAt = new Date().toISOString();
      const signature = await provider.request({ method: "personal_sign", params: [linkMessage(view.agent, address, issuedAt), address] });
      const res = await fetch("/api/buyer/metamask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, issuedAt, signature }) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Could not link the wallet (${res.status})`);
    });

  const approve = (atomic: bigint) =>
    run(atomic === 0n ? "revoke" : "approve", async (provider) => {
      if (!view?.address) throw new Error("Connect the wallet first.");
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [view.agent as Hex, atomic] });
      await sendAndWait(provider, { from: view.address, to: SEPOLIA_USDC, data });
    });

  const unlink = () =>
    run("unlink", async () => {
      await fetch("/api/buyer/metamask", { method: "DELETE" });
    });

  const linked = view?.address;
  return (
    <Card>
      <CardHead
        title="Pay from your own MetaMask"
        hint="Your agent pays shops by their ENS name from your wallet, up to a limit you set. The USDC contract enforces the limit, not Sangam."
        right={<span className="text-xs text-muted">Sepolia · USDC</span>}
      />
      <div className="space-y-3 px-5 py-4 text-sm">
        {view === null ? (
          <p className="flex items-center gap-2 text-muted">
            <Spinner /> Loading…
          </p>
        ) : !linked ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted">Connect MetaMask and sign once to prove it&apos;s yours. Your money stays in your wallet.</p>
            <button
              onClick={connect}
              disabled={busy !== null}
              className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]"
            >
              {busy === "connect" ? "Check your wallet…" : "Connect MetaMask"}
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="min-w-0">
                <p className="text-xs text-muted">Your wallet</p>
                <a href={view.explorer} target="_blank" rel="noreferrer" className="mono block truncate text-xs text-accent underline-offset-2 hover:underline" title={linked}>
                  {linked} ↗
                </a>
              </div>
              <div>
                <p className="text-xs text-muted">USDC in it</p>
                <p className="text-lg font-semibold tabular-nums">{view.balanceAtomic == null ? "—" : usdc(view.balanceAtomic, 2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Your agent may spend</p>
                <p className="text-lg font-semibold tabular-nums">{view.allowanceAtomic == null ? "—" : usdc(view.allowanceAtomic, 2)} USDC</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                Limit
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="w-24 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                  aria-label="Spending limit in USDC"
                />
                USDC
              </label>
              <button
                onClick={() => approve(BigInt(Math.round(Math.max(0, Number(limit) || 0) * 1e6)))}
                disabled={busy !== null}
                className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]"
              >
                {busy === "approve" ? "Confirm in MetaMask…" : "Set agent limit"}
              </button>
              <button onClick={() => approve(0n)} disabled={busy !== null} className="rounded-full border border-line px-3 py-1.5 text-xs transition-colors hover:border-bad">
                {busy === "revoke" ? "Revoking…" : "Revoke"}
              </button>
              <button onClick={unlink} disabled={busy !== null} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
                Unlink
              </button>
            </div>
            <p className="text-[11px] text-muted">
              Needs test USDC from{" "}
              <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                faucet.circle.com
              </a>{" "}
              (Ethereum Sepolia) and a little Sepolia ETH for the approval. Then pick <span className="font-medium">MetaMask · USDC</span> when buying.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-badbg px-3 py-2 text-xs text-bad">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
