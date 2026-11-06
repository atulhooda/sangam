import { NextResponse, type NextRequest } from "next/server";
import { getBoloInvoice } from "@/lib/server/bolo";

export const dynamic = "force-dynamic";

/**
 * GET /api/bolo/invoice/[id]/status — what the buyer (and Bulbul's voice)
 * reads aloud, without paying. No secrets: amount, who it's for, paid or not.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const invoice = getBoloInvoice(id);
  if (!invoice) return NextResponse.json({ error: "No such invoice." }, { status: 404 });
  return NextResponse.json({
    id: invoice.id,
    merchant: invoice.merchant,
    buyer: invoice.buyerName,
    amountPaise: invoice.amountPaise,
    dueDays: invoice.dueDays,
    note: invoice.note,
    status: invoice.status,
    hcsSequence: invoice.hcsSequence,
    settlementTx: invoice.settlementTx,
    createdAt: invoice.createdAt,
  });
}
