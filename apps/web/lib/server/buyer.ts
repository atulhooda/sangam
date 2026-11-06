import "server-only";
import { env, envOr } from "@sangam/shared";
import { buyerAddress, buyerKey, whitechainEnabled } from "@sangam/whitechain";
import { listSettlements } from "./store";
import { currentUser, type SignedIn } from "./session";

/*
 * Buyer-side agent wallets. Each buyer's agent has its own Hedera account
 * (created by Sangam, keyed to the operator so the agent can sign x402
 * payments with no approval prompt). Money moves buyer wallet → merchant's
 * own deposit account (its ENS sangam.payTo) → UPI payout.
 */

/** "2.5" USDC → 2500000 atomic (6 decimals). */
export function parseUsdc(v: string): bigint {
  const m = /^(\d+)(?:\.(\d{0,6}))?$/.exec(v.trim().replace(/^\$/, ""));
  if (!m) throw new Error(`not a USDC amount: "${v}"`);
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
}

/** Lifetime cap on what one buyer's agent may spend (USDC). */
export const buyerBudgetAtomic = () => parseUsdc(envOr("BUYER_AGENT_BUDGET", "5"));
/** Demo faucet: test USDC per click, and the most one buyer can receive. */
export const faucetPerClickAtomic = () => parseUsdc(envOr("BUYER_FAUCET_PER_CLICK", "2"));
export const faucetMaxAtomic = () => parseUsdc(envOr("BUYER_FAUCET_MAX", "6"));

/** The agent signs with the operator key, which is the wallet's key. */
export const agentSigningKey = () => env("OPERATOR_PRIVATE_KEY");

export async function requireBuyer(): Promise<SignedIn | null> {
  const me = await currentUser();
  return me && me.session.role === "user" ? me : null;
}

/** What this buyer's agent has spent on either rail: every settlement it paid, except failed ones. */
export function spentByWallet(accountId: string, whitechainAddress?: string | null): bigint {
  const wc = whitechainAddress?.toLowerCase();
  return listSettlements()
    .filter((s) => (s.payer === accountId || (!!wc && s.payer?.toLowerCase() === wc)) && s.status !== "failed")
    .reduce((sum, s) => sum + BigInt(s.usdcAmount), 0n);
}

/**
 * The buyer's agent on Whitechain: an address derived for this buyer (no
 * account to create), holding USDT and no WBT. It signs EIP-3009 transfers;
 * Sangam's relayer submits them and pays the gas.
 */
export const buyerWhitechainAddress = (buyerId: string) => (whitechainEnabled() ? buyerAddress(buyerId) : null);
export const buyerWhitechainKey = (buyerId: string) => buyerKey(buyerId);
