import "server-only";
import { resolveMerchant } from "@sangam/ens";
import type { ShopId } from "@/lib/demo-shop";
import { bakeryEnsName, merchantEnsName } from "@/lib/server/merchant";
import type { ShopEns } from "./shop-window";

/** What a storefront shows: its merchant's ENS name, price and status, read from ENS. */
export async function loadShopEns(shop: ShopId): Promise<ShopEns> {
  const name = shop === "bakery" ? bakeryEnsName() : merchantEnsName();
  try {
    const r = await resolveMerchant(name);
    return { name, found: true, priceInr: r.priceInrPaise / 100, payTo: r.hederaPayTo, status: r.status ?? "not set" };
  } catch {
    return { name, found: false, priceInr: null, payTo: null, status: null };
  }
}
