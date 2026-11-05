import "server-only";
import { randomInt } from "node:crypto";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { env, envOr, type SettlementNotice } from "@sangam/shared";

/*
 * The demo merchant: an Indian rail-ticket shop that sells over x402.
 * It lives in this app for convenience, but it only talks to Sangam through
 * the public notice API (POST /api/settlements), exactly as an outside
 * merchant would. Moving app/merchant/ to its own server needs no other change.
 */

export const merchantEnsName = () => envOr("MERCHANT_ENS_NAME", "tickets.sangam.eth");

/** Where the merchant sends settlement notices. */
export const sangamApiUrl = () => envOr("SANGAM_API_URL", "http://localhost:5173");

/**
 * Sangam's ONDC gateway as a merchant: ONDC orders are paid to Sangam (the
 * buyer app), so their invoices name this ENS record, which publishes the
 * treasury as sangam.payTo. Buyer agents verify it like any other merchant.
 */
export const ondcGatewayName = () => envOr("ONDC_GATEWAY_ENS", `ondc.${envOr("ENS_PARENT_NAME", "sangam.eth")}`);

/**
 * After a paywalled response: if the facilitator settled a payment (the
 * PAYMENT-RESPONSE header), tell Sangam, awaited, so the settlement row
 * exists before the buyer gets its goods. One place for every paywall,
 * instead of a separate onAfterSettle hook per resource server.
 */
export async function notifyIfSettled(res: Response, merchant: string, tag = "merchant"): Promise<void> {
  const header = res.headers.get("PAYMENT-RESPONSE");
  if (res.status >= 400 || !header) return;
  const settle = decodePaymentResponseHeader(header);
  if (!settle.success || !settle.transaction) return;
  console.log(`[${tag}] ${merchant} settled ${settle.transaction}`);
  // amount may be absent: Sangam's chain check records what actually landed.
  await notifySangam({ merchant, hederaTxId: settle.transaction, payer: settle.payer, usdcAmount: settle.amount ?? "0" }, tag);
}

/**
 * Tell Sangam a payment settled (POST /api/settlements). Awaited so the
 * settlement row exists by the time the buyer has its goods; a failure here
 * never costs the buyer what it paid for.
 */
export async function notifySangam(notice: SettlementNotice, tag = "merchant"): Promise<void> {
  try {
    const res = await fetch(`${sangamApiUrl()}/api/settlements`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sangam-key": env("SETTLEMENT_SHARED_SECRET") },
      body: JSON.stringify(notice),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) console.error(`[${tag}] Sangam rejected the notice: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error(`[${tag}] could not notify Sangam: ${(err as Error).message}`);
  }
}

const TRAINS: Record<string, { number: string; name: string; departs: string; arrives: string }> = {
  "CSMT-PUNE": { number: "12127", name: "Intercity Express", departs: "06:40", arrives: "09:57" },
  "CSMT-NGP": { number: "12289", name: "Duronto Express", departs: "20:15", arrives: "07:55" },
  "BCT-NDLS": { number: "12951", name: "Rajdhani Express", departs: "17:00", arrives: "08:32" },
};

export const KNOWN_ROUTES = Object.keys(TRAINS);

export type Ticket = ReturnType<typeof bookTicket>;

/** The merchant's actual product: a (fake) rail ticket. */
export function bookTicket({ from, to, date }: { from: string; to: string; date: string }) {
  const route = `${from}-${to}`.toUpperCase();
  const train = TRAINS[route] ?? { number: "11007", name: "Deccan Express", departs: "07:10", arrives: "11:05" };
  return {
    pnr: String(randomInt(1_000_000_000, 9_999_999_999)),
    route,
    date,
    train,
    coach: `C${randomInt(1, 9)}`,
    seat: randomInt(1, 78),
    status: "CONFIRMED" as const,
  };
}
