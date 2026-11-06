import { storefront } from "@/lib/server/products";

export const dynamic = "force-dynamic";

/** GET /api/store/bakery.sangam.eth → the merchant's storefront, read from ENS. Public. */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const merchant = decodeURIComponent((await ctx.params).name).toLowerCase();
  try {
    return Response.json(await storefront(merchant), { headers: { "access-control-allow-origin": "*" } });
  } catch (err) {
    return Response.json({ error: `${merchant}: ${(err as Error).message.split("\n")[0]}` }, { status: 404 });
  }
}
