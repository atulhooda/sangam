import { after } from "next/server";
import { resolveMerchant } from "@sangam/ens";
import { inrPerUsd, paiseToUsdcAtomic } from "@sangam/shared";
import { merchantEnsName } from "@/lib/server/merchant";
import { acceptNotice, canSimulate, runPipeline } from "@/lib/server/pipeline";

export const dynamic = "force-dynamic";

/**
 * Dev/demo only: a payment notice as if the merchant had just been paid. It
 * never moves money: simulated rows skip the chain check, get a mock payout and
 * no HCS receipt. { short: true } sends 10% less than the quote, which is held.
 * ALLOW_SIMULATE=false turns this off.
 */
export async function POST(req: Request) {
  if (!canSimulate()) return Response.json({ error: "simulation is off (ALLOW_SIMULATE=false)" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { short?: boolean };
  const name = merchantEnsName();
  const merchant = await resolveMerchant(name);
  let atomic = paiseToUsdcAtomic(merchant.priceInrPaise, await inrPerUsd());
  if (body.short) atomic = (atomic * 9n) / 10n;

  const settlement = await acceptNotice({
    merchant: name,
    hederaTxId: `sim-0.0.1001@${Date.now()}.0`,
    payer: "0.0.1001",
    usdcAmount: atomic.toString(),
  });
  after(() => runPipeline(settlement));
  return Response.json(settlement, { status: 202 });
}
