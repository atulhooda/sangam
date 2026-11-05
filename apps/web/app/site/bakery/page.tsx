import type { Metadata } from "next";
import { SHOPS } from "@/lib/demo-shop";
import { loadShopEns } from "../../demo/shops/load-ens";
import { ShopWindow } from "../../demo/shops/shop-window";
import { SiteShell } from "../site-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Crumbs & Co.", description: "Demo shop for Sangam: pay with an AI agent, checked against ENS." };

/** Crumbs & Co.'s own website, served at "/" when SHOP_SITE=bakery (see proxy.ts). */
export default async function Page() {
  const ens = await loadShopEns("bakery");
  return (
    <SiteShell shop={SHOPS.bakery} ens={ens} menu={["Cakes", "Breads", "Custom orders", "Visit us"]} tagline="Bandra West · since 1998">
      <ShopWindow shop={SHOPS.bakery} ens={ens} />
    </SiteShell>
  );
}
