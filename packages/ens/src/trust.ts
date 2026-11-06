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
 *   3. the invoice pays exactly the Hedera account in that ENS record, on the
 *      same network.
 *
 * A scam site has no name, or names a real merchant but asks to be paid
 * somewhere else: either way the agent refuses. ENS is the source of truth,
 * so any agent can run this check without trusting Sangam's servers.
 */

export class UntrustedPayeeError extends Error {
  constructor(
    message: string,
    readonly reason: "no-name" | "not-sangam" | "unverified" | "suspended" | "payto-mismatch" | "network-mismatch" | "lookup-failed",
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
