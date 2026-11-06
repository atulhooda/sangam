import { formatUsdc, inrPerUsd, paiseToUsdcAtomic, usdcAtomicToPaise } from "@sangam/shared";
import { parentName } from "./wallet.ts";
import { resolveMerchant } from "./resolve.ts";

/*
 * "Verified merchants only": the buyer agent's check before it signs any USDC.
 *
 * AI agents pay whatever answers with a 402, so a fake "IRCTC" site can bill
 * one like a real merchant. Sangam's rule: pay an invoice only when
 *
 *   1. it names a <label>.sangam.eth merchant (invoice extra.ensName),
 *   2. that name's ENS record says sangam.status = "verified" (Self proof +
 *      company certificate, written by Sangam at onboarding), and
 *   3. the invoice pays exactly the account in that ENS record for its chain:
 *      sangam.payTo on Hedera, sangam.payTo.whitechain on Whitechain.
 *
 * A scam site has no name, or names a real merchant but asks to be paid
 * somewhere else: either way the agent refuses. ENS is the source of truth,
 * so any agent can run this check without trusting Sangam's servers.
 */

export class UntrustedPayeeError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "no-name"
      | "not-sangam"
      | "unverified"
      | "suspended"
      | "payto-mismatch"
      | "network-mismatch"
      | "price-mismatch"
      | "origin-mismatch"
      | "lookup-failed",
  ) {
    super(message);
  }
}

export type InvoiceOption = { payTo: string; network: string; amount: string; extra?: Record<string, unknown> };

export type TrustedPayee = { ensName: string; payTo: string; status: string };

export async function assertVerifiedPayee(invoice: InvoiceOption): Promise<TrustedPayee> {
  const ensName = typeof invoice.extra?.ensName === "string" ? invoice.extra.ensName.trim().toLowerCase() : "";
  if (!ensName) {
    throw new UntrustedPayeeError("Refused: this invoice names no Sangam merchant, so there is no one verified to pay.", "no-name");
  }
  if (!ensName.endsWith(`.${parentName()}`)) {
    throw new UntrustedPayeeError(`Refused: ${ensName} is not a ${parentName()} merchant.`, "not-sangam");
  }

  let record;
  try {
    record = await resolveMerchant(ensName);
  } catch (err) {
    throw new UntrustedPayeeError(`Refused: could not read ${ensName} from ENS (${(err as Error).message.split("\n")[0]}).`, "lookup-failed");
  }
  if (record.status === "suspended") {
    throw new UntrustedPayeeError(`Refused: ${ensName} is suspended.`, "suspended");
  }
  if (record.status !== "verified") {
    throw new UntrustedPayeeError(`Refused: ${ensName} has not been verified by Sangam (no Self proof and company certificate on record).`, "unverified");
  }
  // A product name (truffle-cake.bakery.sangam.eth) is only as good as its shop:
  // the shop must still be verified, and the product must pay the shop's own accounts.
  const local = ensName.slice(0, -`.${parentName()}`.length);
  if (local.includes(".")) {
    const shopName = `${local.slice(local.indexOf(".") + 1)}.${parentName()}`;
    let shop;
    try {
      shop = await resolveMerchant(shopName);
    } catch (err) {
      throw new UntrustedPayeeError(`Refused: could not read ${shopName}, the shop selling ${ensName} (${(err as Error).message.split("\n")[0]}).`, "lookup-failed");
    }
    if (shop.status === "suspended") throw new UntrustedPayeeError(`Refused: ${shopName}, which sells ${ensName}, is suspended.`, "suspended");
    if (shop.status !== "verified") throw new UntrustedPayeeError(`Refused: ${shopName}, which sells ${ensName}, has not been verified by Sangam.`, "unverified");
    const wcDiffers = !!record.whitechainPayTo && record.whitechainPayTo.toLowerCase() !== (shop.whitechainPayTo ?? "").toLowerCase();
    if (shop.hederaPayTo !== record.hederaPayTo || wcDiffers) {
      throw new UntrustedPayeeError(`Refused: ${ensName} pays somewhere other than its shop ${shopName}.`, "payto-mismatch");
    }
  }

  // Each rail has its own payout record: Hedera's sangam.payTo + sangam.network,
  // Whitechain's sangam.payTo.whitechain.
  if (invoice.network === WHITECHAIN_NETWORK) {
    if (!record.whitechainPayTo) {
      throw new UntrustedPayeeError(`Refused: the invoice is on Whitechain, but ${ensName} publishes no Whitechain deposit address (sangam.payTo.whitechain).`, "network-mismatch");
    }
    if (record.whitechainPayTo.toLowerCase() !== invoice.payTo.toLowerCase()) {
      throw new UntrustedPayeeError(
        `Refused: the invoice asks for payment to ${invoice.payTo}, but ${ensName}'s ENS record says its Whitechain address is ${record.whitechainPayTo}. This looks like an impersonation.`,
        "payto-mismatch",
      );
    }
    return { ensName, payTo: record.whitechainPayTo, status: record.status };
  }
  if (record.hederaPayTo !== invoice.payTo) {
    throw new UntrustedPayeeError(
      `Refused: the invoice asks for payment to ${invoice.payTo}, but ${ensName}'s ENS record says ${record.hederaPayTo}. This looks like an impersonation.`,
      "payto-mismatch",
    );
  }
  if (record.network !== invoice.network) {
    throw new UntrustedPayeeError(`Refused: the invoice is on ${invoice.network}, ${ensName} takes ${record.network}.`, "network-mismatch");
  }
  return { ensName, payTo: record.hederaPayTo, status: record.status };
}

/** Whitechain Sepolia's CAIP-2 id (kept here so @sangam/ens needs no chain package). */
const WHITECHAIN_NETWORK = "eip155:1874";

/**
 * Exchange-rate wiggle room for the price check, in basis points (2%). The
 * merchant converts its rupee price to USDC when it bills; the agent converts
 * again a moment later, so the two can differ by a small rate move.
 */
export const PRICE_TOLERANCE_BPS = 200;

export type FairPayee = TrustedPayee & {
  /** The rupee price published in the merchant's ENS record. */
  ensPriceInrPaise: number;
  /** That price in USDC atomic units at the current rate. */
  ensPriceAtomic: string;
  /** What the invoice asks for, in USDC atomic units. */
  invoiceAtomic: string;
  /** The rate used, in rupees per USDC. */
  inrPerUsdc: number;
};

/**
 * The stricter check for fixed-price merchants: everything assertVerifiedPayee
 * checks, plus the amount. The invoice may not ask for more than the price in
 * the merchant's ENS record (converted at the current rate, within
 * PRICE_TOLERANCE_BPS). A hacked shop backend can show ₹49 on its page and bill
 * ₹490 in its 402; the agent compares the bill with ENS and refuses to sign.
 *
 * Not for catalogue merchants (ONDC), whose price depends on the order.
 */
export async function assertFairInvoice(invoice: InvoiceOption): Promise<FairPayee> {
  const payee = await assertVerifiedPayee(invoice);
  const record = await resolveMerchant(payee.ensName);
  const rate = await inrPerUsd();
  const ensAtomic = paiseToUsdcAtomic(record.priceInrPaise, rate);
  const billed = BigInt(invoice.amount);
  const ceiling = (ensAtomic * BigInt(10_000 + PRICE_TOLERANCE_BPS)) / 10_000n;
  if (billed > ceiling) {
    const billedInr = usdcAtomicToPaise(billed, rate) / 100;
    const token = invoice.network === WHITECHAIN_NETWORK ? "USDT" : "USDC";
    throw new UntrustedPayeeError(
      `Refused: the invoice asks for ${formatUsdc(billed)} ${token} (about ₹${billedInr.toFixed(2)}), but ${payee.ensName}'s ENS record says the price is ₹${(record.priceInrPaise / 100).toFixed(2)} (${formatUsdc(ensAtomic)} ${token}). The shop's backend is billing more than its published price.`,
      "price-mismatch",
    );
  }
  return {
    ...payee,
    ensPriceInrPaise: record.priceInrPaise,
    ensPriceAtomic: ensAtomic.toString(),
    invoiceAtomic: billed.toString(),
    inrPerUsdc: rate,
  };
}
