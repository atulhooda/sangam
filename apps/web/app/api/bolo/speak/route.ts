import { NextResponse, type NextRequest } from "next/server";
import { sarvamEnabled, speak } from "@sangam/sarvam";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/bolo/speak { text } → { audio: base64 WAV } — Bulbul's Hindi voice. */
export async function POST(req: NextRequest) {
  if (!sarvamEnabled()) return NextResponse.json({ error: "Set SARVAM_API_KEY in .env for spoken confirmations." }, { status: 412 });
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  if (text.length > 500) return NextResponse.json({ error: "Keep spoken lines under 500 characters." }, { status: 413 });
  try {
    const audio = await speak(text);
    return NextResponse.json({ audio: audio.toString("base64") });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
