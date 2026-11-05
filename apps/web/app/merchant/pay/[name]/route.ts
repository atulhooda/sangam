import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { resolveMerchant } from "@sangam/ens";
import { createMerchantServer } from "@sangam/hedera";
import { formatUsdc, inrPerUsd, paiseToUsdcAtomic } from "@sangam/shared";
import { notifyIfSettled } from "@/lib/server/merchant";

export const dynamic = "force-dynamic";

/*
 * A Sangam-hosted x402 payment link for merchants with no API of their own:
 * GET /merchant/pay/riya.sangam.eth → 402 for the price in Riya's ENS record,
 * payable to Riya's own deposit account → a receipt. Onboarding publishes this
 * URL as the merchant's ENS `url` unless the merchant gives its own endpoint.
 */

type Paywall = (req: NextRequest) => Promise<Response>;
const g = globalThis as unknown as { __sangamPaywalls?: Map<string, Paywall> };
const paywalls = (g.__sangamPaywalls ??= new Map());

function paywallFor(ensName: string): Paywall {
  let p = paywalls.get(ensName);
  if (p) return p;
  // Notices are sent from GET (see notifyIfSettled).
  const server = createMerchantServer(() => undefined);
  p = withX402(
    async () => {
      const rec = await resolveMerchant(ensName);
      return NextResponse.json({
        merchant: ensName,
        receipt: { orderId: `SNG-${randomUUID().slice(0, 8).toUpperCase()}`, amountInrPaise: rec.priceInrPaise, paidAt: new Date().toISOString() },
      });
    },
    {
      accepts: {
        scheme: "exact",
        network: "hedera:testnet",
        payTo: async () => (await resolveMerchant(ensName)).hederaPayTo,
        price: async () => `$${formatUsdc(paiseToUsdcAtomic((await resolveMerchant(ensName)).priceInrPaise, await inrPerUsd()))}`,
        extra: { ensName },
      },
      description: `Payment to ${ensName} via Sangam`,
      mimeType: "application/json",
    },
    server,
  );
  paywalls.set(ensName, p);
  return p;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const ensName = decodeURIComponent((await ctx.params).name).toLowerCase();
  try {
    const rec = await resolveMerchant(ensName);
    if (rec.status === "suspended") return NextResponse.json({ error: `${ensName} is suspended` }, { status: 403 });
  } catch (err) {
    return NextResponse.json({ error: `${ensName} is not a Sangam merchant: ${(err as Error).message.split("\n")[0]}` }, { status: 404 });
  }
  const res = await paywallFor(ensName)(req);
  await notifyIfSettled(res, ensName, "pay-link");
  res.headers.set("access-control-allow-origin", "*");
  res.headers.set("access-control-expose-headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  return res;
}
