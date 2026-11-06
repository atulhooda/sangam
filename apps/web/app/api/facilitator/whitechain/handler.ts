import "server-only";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { whitechainEnabled } from "@sangam/whitechain";
import { whitechainFacilitator } from "@/lib/server/rails";

/*
 * Sangam's x402 facilitator for Whitechain, over HTTP, in the standard
 * facilitator shape (GET /supported, POST /verify, POST /settle). A merchant
 * on any server points its x402 middleware here:
 *
 *   new HTTPFacilitatorClient({ url: "https://<sangam>/api/facilitator/whitechain" })
 *
 * and its buyers pay USDT with a signature only; Sangam's relayer pays the gas.
 * The relayer only settles into Sangam merchants' deposit addresses, so this
 * endpoint can be public (see the policy in @sangam/whitechain x402.ts).
 */

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

export const off = () =>
  Response.json({ error: "The Whitechain rail is off on this Sangam (no WHITECHAIN_RELAYER_PRIVATE_KEY)." }, { status: 503, headers: CORS });

export async function readBody(req: Request) {
  const body = (await req.json().catch(() => null)) as { paymentPayload?: PaymentPayload; paymentRequirements?: PaymentRequirements } | null;
  if (!body?.paymentPayload || !body.paymentRequirements) return null;
  return { payload: body.paymentPayload, requirements: body.paymentRequirements };
}

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });
export const options = () => new Response(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET, POST, OPTIONS" } });
export { whitechainEnabled, whitechainFacilitator };
