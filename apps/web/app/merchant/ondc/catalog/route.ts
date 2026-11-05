import { search } from "@sangam/ondc";
import { formatUsdc, inrPerUsd, paiseToUsdcAtomic } from "@sangam/shared";
import { ondcMerchantName, sellerApp } from "@/lib/server/ondc";

export const dynamic = "force-dynamic";

/**
 * Free: search ONDC for an item. Sangam sends a signed ONDC search and
 * returns the seller's on_search catalog in a shape an agent can use.
 *   GET /merchant/ondc/catalog?q=atta
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    const [hits, rate] = await Promise.all([search(q, sellerApp()), inrPerUsd()]);
    const base = new URL(req.url).origin;
    return Response.json(
      {
        query: q,
        network: "ONDC (Retail B2B 2.0.2)",
        results: hits.map((h) => {
          const paise = Math.round(Number(h.item.price.value) * 100);
          const order = new URL("/merchant/ondc/order", base);
          order.searchParams.set("provider", h.provider.id);
          order.searchParams.set("item", h.item.id);
          order.searchParams.set("qty", "1");
          return {
            itemId: h.item.id,
            name: h.item.descriptor.name,
            priceInr: paise / 100,
            approxUsdc: formatUsdc(paiseToUsdcAtomic(paise, rate)),
            provider: { id: h.provider.id, name: h.provider.descriptor.name },
            sellerApp: h.bppId,
            ensName: ondcMerchantName(h.provider.id),
            /** Pay this with x402 to place the order (delivery is added to the quote). */
            orderUrl: order.toString(),
          };
        }),
      },
      { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } },
    );
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
