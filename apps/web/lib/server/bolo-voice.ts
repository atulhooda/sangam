import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { envOr, hasEnv } from "@sangam/shared";

/*
 * The only module that talks to the Bolo voice server. Same contract as
 * Ritu's: HMAC-signed session issue over HTTPS, browser streams audio to the
 * voice server directly, signed completion callback comes back. The web app
 * never touches audio.
 */

export const MAX_SKEW_SECONDS = 300;

const secret = () => process.env.BOLO_SHARED_SECRET?.trim() ?? "";

export const boloVoiceEnabled = () => hasEnv("BOLO_VOICE_URL", "BOLO_SHARED_SECRET");

export const sign = (timestamp: string, body: string): string =>
  createHmac("sha256", secret()).update(`${timestamp}.${body}`).digest("hex");

export function verify(timestamp: string | null | undefined, signature: string | null | undefined, body: string): boolean {
  if (!secret() || !timestamp || !signature) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const a = Buffer.from(sign(timestamp, body), "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type VoiceSession = { session_id: string; ws_url: string; token: string; expires_at: string | null };

/**
 * Create a voice session server-to-server. `script` carries what the
 * conversation is FOR (role, actor, the invoice's status URL); the voice
 * server owns how it's said. Signed like client.py signs Ritu's.
 */
export async function createVoiceSession(script: {
  role: "merchant" | "buyer";
  actor: string;
  statusUrl?: string;
  buyerName?: string;
}): Promise<VoiceSession> {
  const base = envOr("BOLO_VOICE_URL", "").replace(/\/$/, "");
  const body = JSON.stringify({
    external_ref: `sangam:${script.role}:${script.actor}`,
    script,
    callback_url: `${envOr("BOLO_PUBLIC_API_URL", "http://localhost:5173").replace(/\/$/, "")}/api/bolo/callback`,
    max_duration_s: 300,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${base}/v1/browser-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Bolo-Timestamp": ts, "X-Bolo-Signature": sign(ts, body) },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Bolo voice server refused: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as VoiceSession;
}
