import type { Metadata } from "next";
import { storefront, type Storefront } from "@/lib/server/products";
import { currentUser } from "@/lib/server/session";
import { StoreView } from "./store-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const name = decodeURIComponent((await params).name).toLowerCase();
  return { title: `${name} · Sangam store`, description: `Every product from ${name}, each with its own verified ENS name.` };
}

/**
 * A verified merchant's storefront: /store/bakery.sangam.eth. Built from ENS
 * alone (the product list on the shop's name, then each product's own name),
 * so the price shown is the price an agent checks before it pays.
 */
export default async function StorePage({ params }: { params: Promise<{ name: string }> }) {
  const merchant = decodeURIComponent((await params).name).toLowerCase();
  let store: Storefront | null = null;
  let error: string | null = null;
  try {
    store = await storefront(merchant);
  } catch (err) {
    error = (err as Error).message.split("\n")[0] ?? "not found";
  }
  const me = await currentUser();
  return <StoreView merchant={merchant} store={store} error={error} buyer={me?.session.role === "user"} />;
}
