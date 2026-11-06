import { type NextRequest, NextResponse } from "next/server";
import { verify } from "@/lib/server/bolo-voice";
import { completeVoiceSession, createBoloInvoice, getVoiceSession } from "@/lib/server/bolo";

export const dynamic = "force-dynamic";

/**
 * POST /api/bolo/callback — the voice server's signed completion report
 * (HMAC: X-Bolo-Timestamp / X-Bolo-Signature, 5-minute skew window, like
 * Ritu's). This is where conversation becomes action, on Sangam's side of
 * the trust boundary:
 *
 *   merchant + confirmed draft → a real invoice, pinned to HCS, with its
 *   x402 pay link — and the spoken reply the voice server reads aloud.
 *   buyer + confirmed intent   → the session is marked "pay"; the buyer's
 *   own browser (not this webhook) runs the agent, because payment needs
 *   the buyer's session and ENS checks.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  if (
    !verify(
      req.headers.get("x-bolo-timestamp"),
      req.headers.get("x-bolo-signature"),
      body,
    )
  ) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const report = JSON.parse(body) as {
    session_id?: string;
    status?: "completed" | "failed" | "no_input" | "canceled";
    result?: { role?: "merchant" | "buyer"; invoice?: { buyerName: string | null; amountInr: number | null; dueDays: number | null; note: string | null }; intent?: "pay" };
  };
  const session = report.session_id ? getVoiceSession(report.session_id) : undefined;
  if (!session) return NextResponse.json({ error: "unknown session" }, { status: 404 });
  if (session.status !== "open") return NextResponse.json({ reply: null }); // duplicate delivery: ignore

  if (report.status === "completed" && session.role === "merchant" && report.result?.invoice) {
    const d = report.result.invoice;
    if (!d.buyerName || !d.amountInr) return NextResponse.json({ reply: null });
    const invoice = await createBoloInvoice({
      merchant: session.actor,
      buyerName: d.buyerName,
      amountPaise: d.amountInr * 100,
      dueDays: d.dueDays,
      note: d.note,
      transcript: "(live conversation)",
    });
    await completeVoiceSession(session.id, { status: "completed", invoiceId: invoice.id, payUrl: `${new URL(req.url).origin}/api/bolo/invoice/${invoice.id}` });
    return NextResponse.json({ reply: "पे लिंक तैयार है। धन्यवाद!" });
  }

  if (report.status === "completed" && session.role === "buyer" && report.result?.intent === "pay") {
    await completeVoiceSession(session.id, { status: "completed", intent: "pay" });
    return NextResponse.json({ reply: "ठीक है, भर रहे हैं। धन्यवाद!" });
  }

  await completeVoiceSession(session.id, { status: report.status === "completed" ? "completed" : "failed" });
  return NextResponse.json({ reply: null });
}
