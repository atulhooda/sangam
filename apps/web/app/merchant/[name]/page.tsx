import type { Metadata } from "next";
import { MerchantDesk } from "./desk";

export const metadata: Metadata = { title: "Merchant desk · Sangam" };

/** A merchant's own page: /merchant/tickets.sangam.eth. The ENS name is the address. */
export default async function MerchantPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <MerchantDesk name={decodeURIComponent(name)} />;
}
