import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { bookTicket, merchantEnsName, notifyIfSettled } from "@/lib/server/merchant";
import { createSangamServer, merchantAccepts } from "@/lib/server/rails";

export const dynamic = "force-dynamic";

/*
 * The merchant's paywalled endpoint, behind x402 on two rails (Hedera USDC
 * and the buyer's agent signs it):
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

// Settlement notices are sent from GET below (see notifyIfSettled).
const server = createSangamServer();

async function handler(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  return NextResponse.json(
    bookTicket({ from: q.get("from") ?? "CSMT", to: q.get("to") ?? "PUNE", date: q.get("date") ?? new Date().toISOString().slice(0, 10) }),
  );
}

const paid = withX402(
  handler,
  {
    accepts: merchantAccepts(name),
    description: `Rail ticket from ${name}`,
    mimeType: "application/json",
  },
  server,
);

export async function GET(req: NextRequest) {
  const res = await paid(req);
  // Awaited so the settlement row exists by the time the buyer has its ticket.
  await notifyIfSettled(res, name);
  // Let a page on another origin read the invoice and receipt headers.
  res.headers.set("access-control-allow-origin", "*");
  res.headers.set("access-control-expose-headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  return res;
}
