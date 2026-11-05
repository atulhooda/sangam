import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, homeFor, otherRole, publicMe } from "@/lib/server/session";
import { BuyerDesk } from "./desk";

export const metadata: Metadata = { title: "Buyer desk · Sangam" };
export const dynamic = "force-dynamic";

/** Buyers only: signed out → sign in; a merchant session → its own desk. */
export default async function BuyerPage() {
  const me = await currentUser();
  if (!me) redirect("/verify?role=user&next=/buyer");
  if (me.session.role !== "user") redirect(`${homeFor(me.identity)}?from=buyer`);
  return <BuyerDesk me={publicMe(me.identity, otherRole(me))} />;
}
