import { json, off, options, whitechainEnabled, whitechainFacilitator } from "../handler";

export const dynamic = "force-dynamic";

/** GET: what this facilitator settles (exact USDT on eip155:1874) and the relayer that pays gas. */
export async function GET() {
  if (!whitechainEnabled()) return off();
  return json(await whitechainFacilitator().getSupported());
}

export const OPTIONS = options;
