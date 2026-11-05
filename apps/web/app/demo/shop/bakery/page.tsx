import type { Metadata } from "next";
import { SHOPS } from "@/lib/demo-shop";
import { DemoHeader } from "../../shops/demo-header";
import { loadShopEns } from "../../shops/load-ens";
import { ShopWindow } from "../../shops/shop-window";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bakery (backend hacked) · Sangam demo" };

export default async function Page() {
  const ens = await loadShopEns("bakery");
  return (
    <div className="min-h-screen">
      <DemoHeader title="Demo · Bakery (backend hacked)" />
      <main id="main" className="mx-auto max-w-xl px-5 pb-20 pt-10">
        <ShopWindow shop={SHOPS.bakery} ens={ens} />
      </main>
    </div>
  );
}
