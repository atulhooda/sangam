/*
 * Self settings shared by the QR (verify page, browser) and the verifier
 * (/api/self/verify, server). Self binds every proof to the exact scope and
 * endpoint URL, and the QR's network must match the verifier's mock flag, so
 * both halves read them from here and can't drift apart.
 *
 * NEXT_PUBLIC_* values are inlined into the browser bundle at build time:
 * set them before `next build`.
 */

export const SELF_SCOPE = "sangam";
export const SELF_PATH = "/api/self/verify";

/**
 * true: Self's staging network and mock documents (Self app dev mode).
 * false: real Aadhaar / passport proofs on Self's live network.
 * Defaults to mock so local dev works without a public URL.
 */
export const selfMock = (): boolean => (process.env.NEXT_PUBLIC_SELF_MOCK ?? "true").trim().toLowerCase() !== "false";

/**
 * The verify endpoint the proof is bound to. NEXT_PUBLIC_SELF_ENDPOINT is the
 * site's public origin (a full .../api/self/verify URL is accepted too). Set it
 * in production: behind a proxy the server can see http:// or an internal host
 * while the browser sees https://, and one character of difference fails
 * every proof.
 */
export function selfEndpoint(fallbackOrigin: string): string {
  const base = (process.env.NEXT_PUBLIC_SELF_ENDPOINT || fallbackOrigin)
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/self\/verify$/, "");
  return `${base}${SELF_PATH}`;
}
