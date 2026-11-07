import "server-only";
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import type { PaymentOption } from "@x402/core/http";
import type { PaymentRequirements, SettleResponse } from "@x402/core/types";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { resolveMerchant } from "@sangam/ens";
import { HEDERA_NETWORK, hashscanTxUrl, hederaClientScheme, hederaFacilitatorClient, hederaServerScheme } from "@sangam/hedera";
import { formatUsdc, inrPerUsd, paiseToUsdcAtomic } from "@sangam/shared";

/*
 * One payment rail: USDC on Hedera. Every merchant invoice (x402 402) lists a
 * Hedera USDC line; the buyer's agent signs it and the same pipeline takes
 * over (ENS checks, 0G decision, UPI payout, HCS receipt, scheduled refund).
 */

export const explorerUrl = (tx: string) => hashscanTxUrl(tx);

/* ── merchant side ── */

/** An x402 resource server that accepts Hedera USDC (via Blocky402). */
export function createSangamServer(): x402ResourceServer {
  return new x402ResourceServer([hederaFacilitatorClient()]).register("hedera:*", hederaServerScheme());
}

/**
 * The invoice lines for a merchant's ENS name: Hedera USDC to sangam.payTo.
 * Price and payTo are read from ENS per request; `price` overrides the ENS
 * price (in paise).
 */
export function merchantAccepts(ensName: string, opts: { pricePaise?: () => Promise<number>; extra?: Record<string, unknown> } = {}): PaymentOption[] {
  const atomic = async () => paiseToUsdcAtomic(opts.pricePaise ? await opts.pricePaise() : (await resolveMerchant(ensName)).priceInrPaise, await inrPerUsd());
  return [
    {
      scheme: "exact",
      network: HEDERA_NETWORK,
      payTo: async () => (await resolveMerchant(ensName)).hederaPayTo,
      price: async () => `$${formatUsdc(await atomic())}`,
      extra: { ensName, ...opts.extra },
    },
  ];
}

/* ── buyer side ── */

export type AgentPurchase<T> = {
  status: number;
  body: T;
  /** Atomic USDC the chosen invoice line asked for. */
  price: string;
  quote: PaymentRequirements;
  settle: SettleResponse | null;
  payee?: unknown;
};

/** Read a 402's invoice lines. */
export async function probeInvoice(url: string | URL): Promise<PaymentRequirements[]> {
  const probe = await fetch(url, { cache: "no-store" });
  const header = probe.headers.get("PAYMENT-REQUIRED");
  if (probe.status !== 402 || !header) throw new Error(`expected 402 from merchant, got ${probe.status}`);
  return decodePaymentRequiredHeader(header).accepts as PaymentRequirements[];
}

/**
 * A buyer agent that pays Hedera USDC with no human in the loop: its account
 * + ECDSA key. The guard runs on the chosen invoice line before anything is
 * signed.
 */
export function createAgentBuyer(opts: {
  hedera: { accountId: string; privateKey: string };
  /** Per-payment cap in USD, e.g. "$1". */
  maxPerPayment: string;
  guard?: (quote: PaymentRequirements) => Promise<unknown>;
  /** Written into the signed Hedera transfer (shows on HashScan): who paid, and that it was an agent. */
  memo?: string;
}) {
  const client = x402Client.fromConfig({
    schemes: [hederaClientScheme(opts.hedera.accountId, opts.hedera.privateKey, opts.memo)],
    spendControls: { maxAmountPerPayment: opts.maxPerPayment as `$${string}` },
    paymentRequirementsSelector: (_v, accepts) => {
      const q = accepts.find((a) => a.network === HEDERA_NETWORK) ?? accepts[0];
      if (!q) throw new Error("the merchant offers no payment line this agent can pay");
      return q;
    },
  });
  const payingFetch = wrapFetchWithPayment(fetch, client);
  const http = new x402HTTPClient(client);

  async function buy<T = unknown>(url: string | URL): Promise<AgentPurchase<T>> {
    // Refuse before signing: nothing has been paid if the guard throws.
    const quote = (await probeInvoice(url)).find((a) => a.network === HEDERA_NETWORK);
    if (!quote) throw new Error("merchant returned no payment option this agent can pay");
    const payee = opts.guard ? await opts.guard(quote) : undefined;
    const res = await payingFetch(url, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as T;
    let settle: SettleResponse | null = null;
    try {
      settle = http.getPaymentSettleResponse((name) => res.headers.get(name));
    } catch {
      /* no PAYMENT-RESPONSE header: the payment didn't go through */
    }
    return { status: res.status, body, price: quote.amount, quote, settle, payee };
  }

  return { buy };
}
