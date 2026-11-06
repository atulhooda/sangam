import { NextResponse } from "next/server";
import { sarvamEnabled } from "@sangam/sarvam";
import { envOr, mocks } from "@sangam/shared";
import { boloVoiceEnabled } from "@/lib/server/bolo-voice";

export const dynamic = "force-dynamic";

/** GET /api/bolo/config — the panels ask this before showing the mic. */
export async function GET() {
  return NextResponse.json({
    enabled: sarvamEnabled(),
    /** Live voice (Ritu-style streaming session) is up when the voice server is set. */
    voiceEnabled: boloVoiceEnabled(),
    sttModel: envOr("SARVAM_STT_MODEL", "saaras:v4"),
    ttsModel: envOr("SARVAM_TTS_MODEL", "bulbul:v4-flash"),
    /** HCS off in mocks ⇒ invoices still work but skip the consensus write. */
    hcsEnabled: !mocks().hcs && Boolean(process.env.HCS_TOPIC_ID),
  });
}
