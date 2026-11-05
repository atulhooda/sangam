import { resolveMerchant } from "@sangam/ens";
import { formatUsdc, inrPerUsd, paiseToUsdcAtomic, type Quote } from "@sangam/shared";
import { KNOWN_ROUTES, merchantEnsName } from "@/lib/server/merchant";

export const dynamic = "force-dynamic";

/** Free price check, so an agent can decide before paying. */
export async function GET() {
  const m = await resolveMerchant(merchantEnsName());
  const fxRate = await inrPerUsd();
  const quote: Quote = {
    merchant: m.ensName,
    priceInr: m.priceInrPaise / 100,
    priceUsdc: formatUsdc(paiseToUsdcAtomic(m.priceInrPaise, fxRate)),
    network: m.network,
    payTo: m.hederaPayTo,
    upiHandle: m.upiHandle,
    fxRate,
    routes: KNOWN_ROUTES,
  };
  return Response.json(quote, { headers: { "access-control-allow-origin": "*" } });
}
