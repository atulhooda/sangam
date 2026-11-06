import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { getBoloInvoice, markBoloPaid } from "@/lib/server/bolo";
import { merchantAccepts, createSangamServer } from "@/lib/server/rails";
import { notifyIfSettled } from "@/lib/server/merchant";

export const dynamic = "force-dynamic";

/*
 * The Bolo invoice's own x402 paywall. Same two rails as the merchant's shop
 * (Hedera USDC), but priced from what the merchant SAID,
 * not the ENS list price. The buyer agent treats it like any other merchant
 * endpoint: the 402 names the ENS record, so the usual trust checks apply —
 * and once the facilitator settles, notifyIfSettled hands the payment to the
 * same settlement pipeline (chain check → 0G decision → UPI payout → receipt).
 */

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const invoice = getBoloInvoice(id);
  if (!invoice) return NextResponse.json({ error: "No such invoice." }, { status: 404 });

  const server = createSangamServer();
  const handler = async () =>
    NextResponse.json({
      invoice: "paid",
      id: invoice.id,
      buyer: invoice.buyerName,
      amountPaise: invoice.amountPaise,
      receipt: invoice.hcsSequence ? `hcs:${invoice.hcsTopicId}#${invoice.hcsSequence}` : null,
      note: invoice.note,
      thanks: "Sangam receipt on consensus. Tell your customers: bolo, aur baaki sab Sangam sambhalega.",
    });

  const paid = withX402(
    handler,
    {
      accepts: merchantAccepts(invoice.merchant, {
        pricePaise: async () => invoice.amountPaise,
        extra: { boloInvoice: invoice.id, buyer: invoice.buyerName, description: invoice.note ?? "voice invoice" },
      }),
      description: `Sangam voice invoice for ${invoice.buyerName}`,
      mimeType: "application/json",
    },
    server,
  );

  const res = await paid(req);
  // Awaited so the settlement row exists by the time the buyer sees "paid".
  await notifyIfSettled(res, invoice.merchant, "bolo");
  const header = res.headers.get("PAYMENT-RESPONSE");
  if (res.status < 400 && header) {
    try {
      const settle = JSON.parse(atob(header)) as { success?: boolean; transaction?: string };
      if (settle.success && settle.transaction) await markBoloPaid(invoice.id, settle.transaction);
    } catch {
      /* the settlement row is the source of truth; marking is best-effort */
    }
  }
  res.headers.set("access-control-allow-origin", "*");
  res.headers.set("access-control-expose-headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  return res;
}
