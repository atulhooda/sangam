import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { PaymentRequirements, SettleResponse } from "@x402/core/types";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { PrivateKey, createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme as ExactHederaClientScheme } from "@x402/hedera/exact/client";
import { ExactHederaScheme as ExactHederaServerScheme } from "@x402/hedera/exact/server";
import { env, envOr } from "@sangam/shared";
import { HEDERA_NETWORK, USDC_DECIMALS, usdcTokenId } from "./client.ts";

/*
 * x402 on Hedera, both sides of the handshake:
 *
 *   merchant  createMerchantServer()  → 402 invoice, then verify + settle the
 *                                       buyer's signed USDC transfer through
 *                                       the Blocky402 facilitator
 *   buyer     createPayingFetch()     → fetch that reads the 402, signs USDC
 *                                       with the agent's key and retries
 *
 * The facilitator pays the HBAR fee and submits the transfer, so the buyer
 * only ever signs a USDC (HTS) transfer. No smart contract is involved.
 */

export const facilitatorUrl = () => envOr("FACILITATOR_URL", "https://api.testnet.blocky402.com");

export type SettledPayment = { transaction: string; payer?: string; amount: string; network: string };

/**
 * The merchant's x402 resource server. `onSettled` runs after every payment
 * the facilitator settles successfully. The web app's paywalls pass a no-op
 * and notify Sangam from the PAYMENT-RESPONSE header instead (notifyIfSettled).
 */
export function createMerchantServer(onSettled: (p: SettledPayment) => Promise<void> | void): x402ResourceServer {
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl() })).register(
    "hedera:*",
    new ExactHederaServerScheme({
      defaultAssets: { [HEDERA_NETWORK]: { asset: usdcTokenId(), decimals: USDC_DECIMALS } },
    }),
  );
  server.onAfterSettle(async ({ result, requirements }) => {
    if (!result.success) return;
    await onSettled({
      transaction: result.transaction,
      payer: result.payer,
      amount: result.amount ?? requirements.amount,
      network: result.network,
    });
  });
  return server;
}

export type AgentPurchase<T> = {
  status: number;
  body: T;
  /** Atomic USDC the 402 asked for. */
  price: string;
  settle: SettleResponse | null;
  /** What the guard returned for this invoice (e.g. the verified ENS merchant). */
  payee?: unknown;
};

/**
 * Runs on the merchant's invoice before anything is signed. Throw to refuse
 * the payment (e.g. assertVerifiedPayee from @sangam/ens).
 */
export type PaymentGuard = (invoice: PaymentRequirements) => Promise<unknown>;

/**
 * A buyer agent: given the CUSTOMER_* key, pay any x402 endpoint on Hedera
 * with no human in the loop. `maxPerPayment` is a hard cap the SDK enforces.
 */
export function createPayingFetch(opts: { accountId?: string; privateKey?: string; maxPerPayment?: string; guard?: PaymentGuard } = {}) {
  const signer = createClientHederaSigner(
    opts.accountId ?? env("CUSTOMER_ACCOUNT_ID"),
    PrivateKey.fromStringECDSA(opts.privateKey ?? env("CUSTOMER_PRIVATE_KEY")),
    { network: HEDERA_NETWORK },
  );
  const client = x402Client.fromConfig({
    schemes: [{ network: "hedera:*", client: new ExactHederaClientScheme(signer) }],
    spendControls: { maxAmountPerPayment: (opts.maxPerPayment ?? envOr("CUSTOMER_MAX_PER_PAYMENT", "$1")) as `$${string}` },
  });
  const payingFetch = wrapFetchWithPayment(fetch, client);
  const http = new x402HTTPClient(client);

  /** Probe the price (402), then pay and return the merchant's response. */
  async function buy<T = unknown>(url: string | URL): Promise<AgentPurchase<T>> {
    const probe = await fetch(url, { cache: "no-store" });
    const header = probe.headers.get("PAYMENT-REQUIRED");
    if (probe.status !== 402 || !header) throw new Error(`expected 402 from merchant, got ${probe.status}`);
    const quote = decodePaymentRequiredHeader(header).accepts[0];
    if (!quote) throw new Error("merchant returned no payment options");
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
    return { status: res.status, body, price: quote.amount, settle, payee };
  }

  return { buy };
}
