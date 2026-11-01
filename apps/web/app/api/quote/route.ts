import { MERCHANT_ENS_NAME, ROUTES, formatUsdc, inrPerUsd, paiseToUsdcAtomic, resolveMerchant } from "@/lib/server/money";

export const dynamic = "force-dynamic";

/** Free price check, so an agent can decide before paying. */
export async function GET() {
  const m = resolveMerchant(MERCHANT_ENS_NAME);
  const fxRate = await inrPerUsd();
  return Response.json({
    merchant: m.ensName,
    priceInr: m.priceInrPaise / 100,
    priceUsdc: formatUsdc(paiseToUsdcAtomic(m.priceInrPaise, fxRate)),
    network: m.network,
    payTo: m.hederaPayTo,
    upiHandle: m.upiHandle,
    fxRate,
    routes: ROUTES,
  });
}
