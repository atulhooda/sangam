import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { resolveMerchant } from "@sangam/ens";
import { createMerchantServer } from "@sangam/hedera";
import { env, formatUsdc, inrPerUsd, paiseToUsdcAtomic, type SettlementNotice } from "@sangam/shared";
import { bookTicket, merchantEnsName, sangamApiUrl } from "@/lib/server/merchant";

export const dynamic = "force-dynamic";

/*
 * The merchant's paywalled endpoint, behind x402 on Hedera:
 *   unpaid      → 402 with the invoice in the PAYMENT-REQUIRED header
 *   paid        → the facilitator verifies and settles the signed USDC
 *                 transfer, the merchant returns the ticket with a
 *                 PAYMENT-RESPONSE header, and hands the payment to Sangam
 */

const name = merchantEnsName();
const merchant = await resolveMerchant(name);

const server = createMerchantServer(async (paid) => {
  const notice: SettlementNotice = { merchant: name, hederaTxId: paid.transaction, payer: paid.payer, usdcAmount: paid.amount };
  console.log(`[merchant] settled ${notice.hederaTxId} for ${formatUsdc(notice.usdcAmount)} USDC`);
  // Awaited (Sangam answers 202 straight away) so the settlement row exists by
  // the time the buyer has its ticket. A failure here never costs the buyer
  // the ticket they paid for.
  try {
    const res = await fetch(`${sangamApiUrl()}/api/settlements`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sangam-key": env("SETTLEMENT_SHARED_SECRET") },
      body: JSON.stringify(notice),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) console.error(`[merchant] Sangam rejected the notice: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error(`[merchant] could not notify Sangam: ${(err as Error).message}`);
  }
});

async function currentPriceUsd(): Promise<`$${string}`> {
  return `$${formatUsdc(paiseToUsdcAtomic(merchant.priceInrPaise, await inrPerUsd()))}`;
}

async function handler(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  return NextResponse.json(
    bookTicket({ from: q.get("from") ?? "CSMT", to: q.get("to") ?? "PUNE", date: q.get("date") ?? new Date().toISOString().slice(0, 10) }),
  );
}

const paid = withX402(
  handler,
  {
    accepts: {
      scheme: "exact",
      network: merchant.network as `${string}:${string}`,
      payTo: merchant.hederaPayTo,
      price: currentPriceUsd,
    },
    description: `Rail ticket from ${name}, ₹${merchant.priceInrPaise / 100}`,
    mimeType: "application/json",
  },
  server,
);

export async function GET(req: NextRequest) {
  const res = await paid(req);
  // Let a page on another origin read the invoice and receipt headers.
  res.headers.set("access-control-allow-origin", "*");
  res.headers.set("access-control-expose-headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  return res;
}
