import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, homeFor, merchantReady, otherRole, publicMe } from "@/lib/server/session";
import { MerchantDesk } from "./desk";

export const metadata: Metadata = { title: "Merchant desk · Sangam" };
export const dynamic = "force-dynamic";

/**
 * A merchant's own page: /merchant/tickets.sangam.eth. Only the merchant who
 * proved that name with Self, and has a company certificate on file, gets in.
 *   signed out          → sign in as a merchant
 *   buyer session       → back to the buyer desk (buyers can't open merchant desks)
 *   another merchant    → their own desk
 *   no certificate/shop → onboarding
 */
export default async function MerchantPage({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeURIComponent((await params).name).toLowerCase();
  const me = await currentUser();
  if (!me) redirect(`/verify?role=merchant&label=${encodeURIComponent(name)}`);
  if (me.session.role !== "merchant") redirect("/buyer?denied=merchant");
  if (!merchantReady(me.identity)) redirect("/merchant/onboarding");
  if (me.identity.label.toLowerCase() !== name) redirect(homeFor(me.identity));
  return <MerchantDesk name={me.identity.label} me={publicMe(me.identity, otherRole(me))} />;
}
