import { type NextRequest, NextResponse } from "next/server";
import { createBoloInvoice } from "@/lib/server/bolo";
import { currentUser } from "@/lib/server/session";
import { publicOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/bolo/invoice — publish a voice-parsed draft as a real invoice:
 * the merchant's own session (Self-verified) approves it, it lands on the HCS
 * receipt topic, and the response carries the x402 pay link with the SPOKEN
 * price. The buyer agent pays it exactly like any other Sangam payment.
 */
export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me || me.identity.role !== "merchant" || !me.identity.label) {
    return NextResponse.json({ error: "Sign in as a merchant with Self to issue invoices." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    transcript?: string;
    buyerName?: string;
    amountPaise?: number;
    dueDays?: number | null;
    note?: string | null;
  };
  const buyerName = body.buyerName?.trim();
  const amountPaise = Math.round(Number(body.amountPaise));
  if (!buyerName) return NextResponse.json({ error: "Whom is this invoice for? (buyerName)" }, { status: 400 });
  if (!Number.isFinite(amountPaise) || amountPaise <= 0 || amountPaise > 1_000_000_00 * 100)
    return NextResponse.json({ error: "The amount didn't parse to a valid rupee figure." }, { status: 400 });

  const invoice = await createBoloInvoice({
    merchant: me.identity.label,
    buyerName,
    amountPaise,
    dueDays: body.dueDays ?? null,
    note: body.note ?? null,
    transcript: body.transcript ?? "",
  });
  return NextResponse.json({
    id: invoice.id,
    invoice,
    payUrl: `${publicOrigin(req)}/api/bolo/invoice/${invoice.id}`,
    statusUrl: `${publicOrigin(req)}/api/bolo/invoice/${invoice.id}/status`,
  });
}
