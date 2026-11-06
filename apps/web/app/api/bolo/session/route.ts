import { type NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { boloVoiceEnabled, createVoiceSession } from "@/lib/server/bolo-voice";
import { recordVoiceSession } from "@/lib/server/bolo";

export const dynamic = "force-dynamic";

/**
 * POST /api/bolo/session — start a live Bolo conversation.
 *
 * Self-authenticated web route → HMAC-signed session on the voice server →
 * the browser gets {session_id, ws_url, token} and streams audio to the voice
 * server DIRECTLY. This app never relays audio — the same split as
 * OncoReady ⇄ Ritu. Completion arrives via the signed callback.
 */
export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Sign in with Self first." }, { status: 401 });
  if (!boloVoiceEnabled())
    return NextResponse.json({ error: "Set BOLO_VOICE_URL and BOLO_SHARED_SECRET in .env to talk to Bolo." }, { status: 412 });

  const body = (await req.json().catch(() => ({}))) as { role?: "merchant" | "buyer"; invoiceUrl?: string; shops?: unknown };
  const role = me.identity.role === "merchant" ? "merchant" : "buyer";
  // A buyer may name the invoice in the request; a merchant's script is generic.
  let statusUrl: string | undefined;
  let buyerName: string | undefined;
  if (body.invoiceUrl && role === "buyer") {
    statusUrl = `${body.invoiceUrl.replace(/\/$/, "")}/status`;
    try {
      const status = (await (await fetch(statusUrl, { cache: "no-store", signal: AbortSignal.timeout(5_000) })).json()) as { buyer?: string };
      buyerName = status.buyer;
    } catch {
      /* the voice read-out will say the invoice wasn't found */
    }
  }

  // Buying by voice: the shops the buyer's desk lists. Each purchase still
  // goes through /api/agent/buy and its ENS + fair-invoice checks.
  const shops =
    role === "buyer" && !statusUrl && Array.isArray(body.shops)
      ? body.shops
          .filter((s): s is { ensName: string; priceInrPaise?: unknown } => typeof s?.ensName === "string" && /^[a-z0-9.-]{3,80}$/i.test(s.ensName))
          .slice(0, 20)
          .map((s) => ({ ensName: s.ensName, ...(typeof s.priceInrPaise === "number" && s.priceInrPaise > 0 ? { priceInrPaise: Math.round(s.priceInrPaise) } : {}) }))
      : undefined;
  const created = await createVoiceSession({
    role,
    actor: me.identity.label,
    statusUrl,
    buyerName: role === "buyer" ? (buyerName ?? undefined) : undefined,
    shops,
  });
  await recordVoiceSession({ id: created.session_id, role, actor: me.identity.label });
  return NextResponse.json({ session_id: created.session_id, ws_url: created.ws_url, token: created.token });
}
