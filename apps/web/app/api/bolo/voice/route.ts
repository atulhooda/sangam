import { type NextRequest, NextResponse } from "next/server";
import { parseBuyerIntent, parseMerchantInvoice, sarvamEnabled, type InvoiceDraft } from "@sangam/sarvam";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/bolo/voice — multipart: { audio, role: "merchant" | "buyer" }.
 *
 * Audio → Saaras transcript → Sarvam-105B parse. No side effects: the
 * merchant still confirms the parsed draft (and the buyer still triggers the
 * payment) before anything happens.
 */
export async function POST(req: NextRequest) {
  if (!sarvamEnabled()) return NextResponse.json({ error: "Set SARVAM_API_KEY in .env to speak to Sangam." }, { status: 412 });
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  const role = form?.get("role") === "buyer" ? "buyer" : "merchant";
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "No audio in the request." }, { status: 400 });
  if (audio.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Recording too long — speak the invoice in one go." }, { status: 413 });

  try {
    const { transcribe, parseMerchantInvoice, parseBuyerIntent } = await import("@sangam/sarvam");
    const { transcript } = await transcribe(audio, { mode: "codemix" });
    if (!transcript) return NextResponse.json({ error: "Sarvam heard nothing — try again, a little louder." }, { status: 422 });
    const parsed =
      role === "buyer" ? { ...(await parseBuyerIntent(transcript)), buyerName: null, amountInr: null, dueDays: null, note: null } : await parseMerchantInvoice(transcript);
    return NextResponse.json({ role, transcript, parsed: parsed as InvoiceDraft & { intent?: string } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
