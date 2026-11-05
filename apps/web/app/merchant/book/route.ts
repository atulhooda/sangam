import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { resolveMerchant } from "@sangam/ens";
import { createMerchantServer } from "@sangam/hedera";
import { formatUsdc, inrPerUsd, paiseToUsdcAtomic } from "@sangam/shared";
import { bookTicket, merchantEnsName, notifySangam } from "@/lib/server/merchant";

export const dynamic = "force-dynamic";

/*
 * The merchant's paywalled endpoint, behind x402 on Hedera:
 *   unpaid      → 402 with the invoice in the PAYMENT-REQUIRED header
 *   paid        → the facilitator verifies and settles the signed USDC
 *                 transfer, the merchant returns the ticket with a
 *                 PAYMENT-RESPONSE header, and hands the payment to Sangam
 *
 * Price and payTo are read from the merchant's ENS record on each request
 * (cached 60 s), so re-onboarding (a new deposit account, a new price) takes
 * effect without a restart. The invoice names the ENS name, so buyer agents
 * can check payTo against ENS before paying.
 */

const name = merchantEnsName();

const server = createMerchantServer(async (paid) => {
  console.log(`[merchant] settled ${paid.transaction} for ${formatUsdc(paid.amount)} USDC`);
  await notifySangam({ merchant: name, hederaTxId: paid.transaction, payer: paid.payer, usdcAmount: paid.amount });
});

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
      network: "hedera:testnet",
      payTo: async () => (await resolveMerchant(name)).hederaPayTo,
      price: async () => `$${formatUsdc(paiseToUsdcAtomic((await resolveMerchant(name)).priceInrPaise, await inrPerUsd()))}`,
      extra: { ensName: name },
    },
    description: `Rail ticket from ${name}`,
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
