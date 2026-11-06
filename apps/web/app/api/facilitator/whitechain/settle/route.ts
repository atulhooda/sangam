import { json, off, options, readBody, whitechainEnabled, whitechainFacilitator } from "../handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { paymentPayload, paymentRequirements } → the x402 settle response. */
export async function POST(req: Request) {
  if (!whitechainEnabled()) return off();
  const body = await readBody(req);
  if (!body) return json({ error: "send { paymentPayload, paymentRequirements }" }, 400);
  try {
    return json(await whitechainFacilitator().settle(body.payload, body.requirements));
  } catch (err) {
    return json({ error: (err as Error).message.split("\n")[0] }, 502);
  }
}

export const OPTIONS = options;
