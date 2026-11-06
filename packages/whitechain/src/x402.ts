import type { FacilitatorClient } from "@x402/core/server";
import { x402Facilitator } from "@x402/core/facilitator";
import type { AssetAmount, PaymentRequirements, SupportedResponse } from "@x402/core/types";
import { toClientEvmSigner, toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme as ExactEvmClientScheme } from "@x402/evm/exact/client";
import { ExactEvmScheme as ExactEvmFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { ExactEvmScheme as ExactEvmServerScheme } from "@x402/evm/exact/server";
import { isAddressEqual, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { envOr } from "@sangam/shared";
import { USDT_EIP712, WHITECHAIN_NETWORK, relayerAccount, relayerWallet, usdtAddress, whitechainClient } from "./chain.ts";
import { wbtBalance } from "./tokens.ts";

/*
 * x402 on Whitechain, all three roles:
 *
 *   merchant     whitechainServerScheme() + whitechainPrice() → a USDT line in
 *                the 402 invoice, next to the Hedera USDC line
 *   facilitator  createWhitechainFacilitator() → Sangam's own facilitator:
 *                verifies the buyer's EIP-3009 signature and submits it from
 *                the relayer, which pays the WBT gas
 *   buyer        whitechainClientScheme() → the agent signs a USDT
 *                transferWithAuthorization; it never holds WBT or sends a tx
 *
 * Nobody else runs an x402 facilitator for Whitechain, so Sangam does.
 */

/** The USDT price line for a Whitechain invoice: atomic amount + the token's EIP-712 domain. */
export function whitechainPrice(atomic: bigint | string): AssetAmount {
  return { asset: usdtAddress(), amount: atomic.toString(), extra: { ...USDT_EIP712 } };
}

/** Merchant side: register on an x402ResourceServer under WHITECHAIN_NETWORK. */
export const whitechainServerScheme = () => new ExactEvmServerScheme();

/** Buyer side: an x402Client scheme registration that signs with `privateKey`. */
export function whitechainClientScheme(privateKey: Hex) {
  const signer = toClientEvmSigner(privateKeyToAccount(privateKey), whitechainClient());
  return { network: WHITECHAIN_NETWORK, client: new ExactEvmClientScheme(signer) } as const;
}

/** The buyer's spend control for USDT on Whitechain (the SDK only knows default assets). */
export const whitechainSpendControl = (maxAtomic: bigint) => ({
  network: WHITECHAIN_NETWORK,
  asset: usdtAddress(),
  maxAmountPerPayment: maxAtomic.toString(),
});

/* ── Sangam's facilitator ───────────────────────────────────────────── */

/** Which addresses the relayer will pay gas to settle into (Sangam merchants' deposit addresses). */
export type PayToPolicy = (payTo: Hex) => boolean | Promise<boolean>;

/** Largest single payment the relayer will sponsor, in atomic USDT (WHITECHAIN_MAX_PER_PAYMENT, default 25). */
export const maxSponsoredAtomic = () => BigInt(Math.round(Number(envOr("WHITECHAIN_MAX_PER_PAYMENT", "25").replace(/^\$/, "")) * 1e6));
/** The relayer stops sponsoring below this much WBT, keeping enough for receipts and refunds. */
const minRelayerWei = () => parseEther(envOr("WHITECHAIN_MIN_RELAYER_WBT", "0.002"));
/** Settlements one payer may have sponsored per minute. */
const PAYER_PER_MINUTE = 6;

const g = globalThis as unknown as { __sangamWcPayers?: Map<string, number[]> };
const recentByPayer = (g.__sangamWcPayers ??= new Map());

/**
 * The anti-drain rules, checked before verify and again before settle. The
 * relayer's WBT is the only thing at risk (the USDT is the payer's own, moved
 * by the payer's own signature), and these keep anyone from burning it:
 *
 *   1. only Whitechain USDT, only by EIP-3009 (no Permit2 approvals to sponsor);
 *   2. only into a Sangam merchant's deposit address (payTo allowlist);
 *   3. at most WHITECHAIN_MAX_PER_PAYMENT per payment;
 *   4. at most PAYER_PER_MINUTE settlements per payer per minute;
 *   5. never below WHITECHAIN_MIN_RELAYER_WBT of gas in reserve.
 *
 * Every rejected attempt costs the attacker nothing but also costs the relayer
 * nothing: verification is an eth_call, not a transaction.
 */
async function policy(req: PaymentRequirements, payer: string | undefined, allowPayTo: PayToPolicy, settling: boolean): Promise<string | null> {
  if (req.network !== WHITECHAIN_NETWORK) return `unsupported network ${req.network}`;
  if (!isAddressEqual(req.asset as Hex, usdtAddress())) return "only Whitechain USDT is sponsored";
  if ((req.extra?.assetTransferMethod ?? "eip3009") !== "eip3009") return "only EIP-3009 transfers are sponsored";
  if (!(await allowPayTo(req.payTo as Hex))) return `${req.payTo} is not a Sangam merchant deposit address`;
  if (BigInt(req.amount) > maxSponsoredAtomic()) return `amount ${req.amount} is over the sponsored limit ${maxSponsoredAtomic()}`;
  if (payer) {
    const now = Date.now();
    const recent = (recentByPayer.get(payer.toLowerCase()) ?? []).filter((t: number) => now - t < 60_000);
    if (recent.length >= PAYER_PER_MINUTE) return "too many payments from this payer; try again in a minute";
    if (settling) recentByPayer.set(payer.toLowerCase(), [...recent, now]);
  }
  if (settling && (await wbtBalance(relayerAccount().address)) < minRelayerWei()) return "Sangam's relayer is low on gas";
  return null;
}

const payerOf = (payload: { payload?: unknown }) =>
  ((payload.payload as { authorization?: { from?: string } } | undefined)?.authorization?.from ?? undefined) as string | undefined;

/**
 * Sangam's in-process x402 facilitator for Whitechain. Returned as a
 * FacilitatorClient, so an x402ResourceServer uses it exactly like a hosted
 * one; the web app also serves it over HTTP for merchants on other servers.
 */
export function createWhitechainFacilitator(opts: { allowPayTo: PayToPolicy }): FacilitatorClient & { raw: x402Facilitator } {
  const wallet = relayerWallet();
  const signer = toFacilitatorEvmSigner({ ...wallet, address: wallet.account.address } as unknown as Parameters<typeof toFacilitatorEvmSigner>[0], {
    confirmationTimeoutMs: 45_000,
  });
  // x402 v2 on Whitechain only (registerExactEvmScheme would also advertise v1 on every EVM chain).
  const facilitator = new x402Facilitator().register(WHITECHAIN_NETWORK, new ExactEvmFacilitatorScheme(signer));
  facilitator.onBeforeVerify(async ({ paymentPayload, requirements }) => {
    const reason = await policy(requirements, payerOf(paymentPayload), opts.allowPayTo, false);
    return reason ? { abort: true, reason } : undefined;
  });
  facilitator.onBeforeSettle(async ({ paymentPayload, requirements }) => {
    const reason = await policy(requirements, payerOf(paymentPayload), opts.allowPayTo, true);
    return reason ? { abort: true, reason } : undefined;
  });
  return {
    raw: facilitator,
    verify: (p, r) => facilitator.verify(p, r),
    settle: (p, r) => facilitator.settle(p, r),
    getSupported: async () => facilitator.getSupported() as SupportedResponse,
  };
}
