import "server-only";
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { PaymentOption } from "@x402/core/http";
import type { PaymentRequirements, SettleResponse } from "@x402/core/types";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import type { Hex } from "viem";
import { resolveMerchant } from "@sangam/ens";
import { HEDERA_NETWORK, hashscanTxUrl, hederaClientScheme, hederaFacilitatorClient, hederaServerScheme } from "@sangam/hedera";
import { formatUsdc, inrPerUsd, paiseToUsdcAtomic } from "@sangam/shared";
import {
  WHITECHAIN_NETWORK,
  createWhitechainFacilitator,
  depositAddress,
  explorerTxUrl,
  isWhitechainTx,
  whitechainClientScheme,
  whitechainEnabled,
  whitechainPrice,
  whitechainServerScheme,
  whitechainSpendControl,
} from "@sangam/whitechain";
import { listDepositAccounts } from "./identity";
import { bakeryEnsName, merchantEnsName, ondcGatewayName } from "./merchant";

/*
 * Two payment rails, one Sangam. Every merchant invoice (x402 402) lists a
 * Hedera USDC line and, when the Whitechain rail is on, a Whitechain USDT
 * line. The buyer's agent pays on whichever rail it prefers; everything after
 * that (ENS checks, 0G decision, UPI payout, on-chain receipt, refund) is the
 * same pipeline with a rail-specific chain step.
 */

export type Rail = "hedera" | "whitechain";
export const RAILS: Rail[] = ["hedera", "whitechain"];

export const railOfNetwork = (network: string): Rail => (network === WHITECHAIN_NETWORK ? "whitechain" : "hedera");
export const railOfTx = (tx: string): Rail => (isWhitechainTx(tx) ? "whitechain" : "hedera");
export const networkOf = (rail: Rail) => (rail === "whitechain" ? WHITECHAIN_NETWORK : HEDERA_NETWORK);
export const parseRail = (v: unknown): Rail | null => (v === "hedera" || v === "whitechain" ? v : null);
export const explorerUrl = (tx: string) => (isWhitechainTx(tx) ? explorerTxUrl(tx) : hashscanTxUrl(tx));
export const enabledRails = (): Rail[] => (whitechainEnabled() ? RAILS : ["hedera"]);

/* ── facilitator ── */

/** Every merchant name whose Whitechain deposit address the relayer will settle into. */
export function knownMerchantNames(): string[] {
  return [...new Set([merchantEnsName(), bakeryEnsName(), ondcGatewayName(), ...listDepositAccounts().map((a) => a.ensName)])];
}

/** Deposit addresses are derived, so the allowlist is recomputed from the merchant list (cached 30 s). */
const g = globalThis as unknown as {
  __sangamWcAllow?: { at: number; set: Set<string> };
  __sangamWcFacilitator?: ReturnType<typeof createWhitechainFacilitator>;
};

function isSangamDepositAddress(payTo: Hex): boolean {
  const hit = g.__sangamWcAllow;
  if (!hit || Date.now() - hit.at > 30_000) {
    g.__sangamWcAllow = { at: Date.now(), set: new Set(knownMerchantNames().map((n) => depositAddress(n).toLowerCase())) };
  }
  return g.__sangamWcAllow!.set.has(payTo.toLowerCase());
}

/** Sangam's own x402 facilitator for Whitechain (one per process). */
export function whitechainFacilitator() {
  g.__sangamWcFacilitator ??= createWhitechainFacilitator({ allowPayTo: isSangamDepositAddress });
  return g.__sangamWcFacilitator;
}

/* ── merchant side ── */

/** An x402 resource server that accepts both rails (Hedera via Blocky402, Whitechain via Sangam's facilitator). */
export function createSangamServer(): x402ResourceServer {
  const clients: FacilitatorClient[] = [hederaFacilitatorClient()];
  if (whitechainEnabled()) clients.push(whitechainFacilitator());
  const server = new x402ResourceServer(clients).register("hedera:*", hederaServerScheme());
  if (whitechainEnabled()) server.register(WHITECHAIN_NETWORK, whitechainServerScheme());
  return server;
}

/**
 * The invoice lines for a merchant's ENS name: Hedera USDC to sangam.payTo,
 * and Whitechain USDT to sangam.payTo.whitechain. Price and payTo are read
 * from ENS per request; `price` overrides the ENS price (in paise).
 */
export function merchantAccepts(ensName: string, opts: { pricePaise?: () => Promise<number>; extra?: Record<string, unknown> } = {}): PaymentOption[] {
  const atomic = async () => paiseToUsdcAtomic(opts.pricePaise ? await opts.pricePaise() : (await resolveMerchant(ensName)).priceInrPaise, await inrPerUsd());
  const extra = { ensName, ...opts.extra };
  const accepts: PaymentOption[] = [
    {
      scheme: "exact",
      network: HEDERA_NETWORK,
      payTo: async () => (await resolveMerchant(ensName)).hederaPayTo,
      price: async () => `$${formatUsdc(await atomic())}`,
      extra,
    },
  ];
  if (whitechainEnabled()) {
    accepts.push({
      scheme: "exact",
      network: WHITECHAIN_NETWORK,
      // The address in ENS; a merchant that hasn't published one is billed at its
      // derived address, which verified-only agents refuse (no ENS record to match).
      payTo: async () => (await resolveMerchant(ensName)).whitechainPayTo ?? depositAddress(ensName),
      price: async () => whitechainPrice(await atomic()),
      extra,
    });
  }
  return accepts;
}

/* ── buyer side ── */

export type AgentPurchase<T> = {
  status: number;
  body: T;
  rail: Rail;
  /** Atomic USDC/USDT the chosen invoice line asked for. */
  price: string;
  quote: PaymentRequirements;
  settle: SettleResponse | null;
  payee?: unknown;
};

/** Pick the invoice line for the preferred rail, else the first line this agent can pay. */
export function pickQuote(accepts: PaymentRequirements[], prefer: Rail, payable: Rail[]): PaymentRequirements | undefined {
  return (
    accepts.find((a) => a.network === networkOf(prefer) && payable.includes(prefer)) ??
    accepts.find((a) => payable.includes(railOfNetwork(a.network)))
  );
}

/** Read a 402's invoice lines. */
export async function probeInvoice(url: string | URL): Promise<PaymentRequirements[]> {
  const probe = await fetch(url, { cache: "no-store" });
  const header = probe.headers.get("PAYMENT-REQUIRED");
  if (probe.status !== 402 || !header) throw new Error(`expected 402 from merchant, got ${probe.status}`);
  return decodePaymentRequiredHeader(header).accepts as PaymentRequirements[];
}

/**
 * A buyer agent that can pay on both rails with no human in the loop:
 * Hedera with its account + ECDSA key, Whitechain with an EVM key (the same
 * secp256k1 key works). It pays on `rail` when the merchant offers it.
 * The guard runs on the chosen invoice line before anything is signed.
 */
export function createAgentBuyer(opts: {
  rail: Rail;
  hedera?: { accountId: string; privateKey: string };
  whitechainKey?: Hex;
  /** Per-payment cap in USD, e.g. "$1". */
  maxPerPayment: string;
  guard?: (quote: PaymentRequirements) => Promise<unknown>;
}) {
  const payable: Rail[] = [];
  const schemes = [];
  if (opts.hedera) {
    schemes.push(hederaClientScheme(opts.hedera.accountId, opts.hedera.privateKey));
    payable.push("hedera");
  }
  if (opts.whitechainKey && whitechainEnabled()) {
    schemes.push(whitechainClientScheme(opts.whitechainKey));
    payable.push("whitechain");
  }
  const capAtomic = BigInt(Math.round(Number(opts.maxPerPayment.replace(/^\$/, "")) * 1e6));
  const client = x402Client.fromConfig({
    schemes,
    spendControls: {
      maxAmountPerPayment: opts.maxPerPayment as `$${string}`,
      allowedAssets: whitechainEnabled() ? [whitechainSpendControl(capAtomic)] : undefined,
    },
    paymentRequirementsSelector: (_v, accepts) => {
      const q = pickQuote(accepts, opts.rail, payable);
      if (!q) throw new Error("the merchant offers no rail this agent can pay on");
      return q;
    },
  });
  const payingFetch = wrapFetchWithPayment(fetch, client);
  const http = new x402HTTPClient(client);

  async function buy<T = unknown>(url: string | URL): Promise<AgentPurchase<T>> {
    const quote = pickQuote(await probeInvoice(url), opts.rail, payable);
    if (!quote) throw new Error("merchant returned no payment option this agent can pay");
    // Refuse before signing: nothing has been paid if the guard throws.
    const payee = opts.guard ? await opts.guard(quote) : undefined;
    const res = await payingFetch(url, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as T;
    let settle: SettleResponse | null = null;
    try {
      settle = http.getPaymentSettleResponse((name) => res.headers.get(name));
    } catch {
      /* no PAYMENT-RESPONSE header: the payment didn't go through */
    }
    return { status: res.status, body, rail: railOfNetwork(quote.network), price: quote.amount, quote, settle, payee };
  }

  return { buy, payable };
}
