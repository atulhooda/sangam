import { after } from "next/server";
import { MERCHANT_ENS_NAME, inrPerUsd, paiseToUsdcAtomic, resolveMerchant } from "@/lib/server/money";
import { acceptNotice, runPipeline } from "@/lib/server/pipeline";

export const dynamic = "force-dynamic";

/**
 * Simulation only: creates a payment notice as if merchant-api had just been
 * paid, then runs the settlement pipeline in the background (after the
 * response), so the dashboard can watch it move. { short: true } sends 10%
 * less than the quote, which the decision step holds.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { short?: boolean };
  const merchant = resolveMerchant(MERCHANT_ENS_NAME);
  let atomic = paiseToUsdcAtomic(merchant.priceInrPaise, await inrPerUsd());
  if (body.short) atomic = (atomic * 9n) / 10n;

  const settlement = await acceptNotice({
    merchant: MERCHANT_ENS_NAME,
    hederaTxId: `sim-0.0.1001@${Date.now()}.0`,
    payer: "0.0.1001",
    usdcAmount: atomic.toString(),
  });
  after(() => runPipeline(settlement));
  return Response.json(settlement, { status: 202 });
}
