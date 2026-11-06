import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { readProductInfo, resolveMerchant } from "@sangam/ens";
import { notifyIfSettled } from "@/lib/server/merchant";
import { createSangamServer, merchantAccepts } from "@/lib/server/rails";

export const dynamic = "force-dynamic";

/*
 * One product's x402 paywall: GET /store/bakery.sangam.eth/truffle-cake/buy.
 * This is the url in the product's own ENS name. The invoice names the
 * product's ENS name, so an agent checks the bill against the product's price
 * and the shop's payout accounts in ENS before it signs. Pays on Hedera (USDC)
 * or Whitechain (USDT); the settlement is booked to the shop, tagged with the
 * product.
 */

type Paywall = (req: NextRequest) => Promise<Response>;
const g = globalThis as unknown as { __sangamProductPaywalls?: Map<string, Paywall> };
const paywalls = (g.__sangamProductPaywalls ??= new Map());

function paywallFor(productName: string): Paywall {
  let p = paywalls.get(productName);
  if (p) return p;
  p = withX402(
    async () => {
      const [rec, info] = await Promise.all([resolveMerchant(productName), readProductInfo(productName)]);
      return NextResponse.json({
        merchant: info.merchant,
        product: { ensName: productName, title: info.title },
        receipt: { orderId: `SNG-${randomUUID().slice(0, 8).toUpperCase()}`, amountInrPaise: rec.priceInrPaise, paidAt: new Date().toISOString() },
      });
    },
    { accepts: merchantAccepts(productName), description: `${productName} via Sangam`, mimeType: "application/json" },
    createSangamServer(),
  );
  paywalls.set(productName, p);
  return p;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string; product: string }> }) {
  const { name, product } = await ctx.params;
  const merchant = decodeURIComponent(name).toLowerCase();
  const productName = `${decodeURIComponent(product).toLowerCase()}.${merchant}`;
  let title = productName;
  try {
    const [shop, rec, info] = await Promise.all([resolveMerchant(merchant), resolveMerchant(productName), readProductInfo(productName)]);
    if (shop.status !== "verified" || rec.status !== "verified") return NextResponse.json({ error: `${productName} is not for sale` }, { status: 403 });
    if (info.merchant !== merchant) return NextResponse.json({ error: `${productName} doesn't belong to ${merchant}` }, { status: 404 });
    title = info.title || title;
  } catch (err) {
    return NextResponse.json({ error: `${productName} is not a Sangam product: ${(err as Error).message.split("\n")[0]}` }, { status: 404 });
  }
  const res = await paywallFor(productName)(req);
  // Book the sale to the shop (its desk and payout), tagged with the product.
  await notifyIfSettled(res, merchant, "store", { product: { ensName: productName, title } });
  res.headers.set("access-control-allow-origin", "*");
  res.headers.set("access-control-expose-headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  return res;
}
