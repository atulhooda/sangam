import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * The exact HMAC scheme Ritu's integration uses (docs/VOICE_INTEGRATION.md):
 *   X-Bolo-Timestamp: unix seconds
 *   X-Bolo-Signature: hex(HMAC_SHA256(secret, timestamp + "." + raw_body))
 * Receivers reject anything more than 5 minutes off. One shared secret signs
 * both directions: the web app → here, and the completion callback → back.
 */

export const MAX_SKEW_SECONDS = 300;

export const sign = (timestamp: string, body: string, secret = process.env.BOLO_SHARED_SECRET?.trim() ?? ""): string =>
  createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

export function verify(timestamp: string | null | undefined, signature: string | null | undefined, body: string): boolean {
  const secret = process.env.BOLO_SHARED_SECRET?.trim();
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const expected = sign(timestamp, body, secret);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
