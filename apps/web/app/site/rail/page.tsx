import type { Metadata } from "next";
import { SHOPS } from "@/lib/demo-shop";
import { loadShopEns } from "../../demo/shops/load-ens";
import { ShopWindow } from "../../demo/shops/shop-window";
import { SiteShell } from "../site-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "RailKart", description: "Demo shop for Sangam: pay with an AI agent, checked against ENS." };

/** RailKart's own website, served at "/" when SHOP_SITE=rail (see proxy.ts). */
export default async function Page() {
  const ens = await loadShopEns("rail");
  return (
    <SiteShell shop={SHOPS.rail} ens={ens} menu={["Trains", "PNR status", "Offers", "Help"]} tagline="Indian Railways tickets">
      <ShopWindow shop={SHOPS.rail} ens={ens} />
    </SiteShell>
  );
}
