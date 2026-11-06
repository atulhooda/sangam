import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, hasPassword, homeFor, otherRole, publicMe } from "@/lib/server/session";
import { OnboardingFlow } from "./flow";

export const metadata: Metadata = { title: "Merchant onboarding · Sangam" };
export const dynamic = "force-dynamic";

/**
 * Merchant onboarding after the Self proof:
 *   step 2  claim a name → <name>.sangam.eth published on ENS, marked verified
 *   step 3  set a password → sign in with name + password (or Self) from then on
 * Then the merchant's desk, where it lists its products and prices.
 */
export default async function OnboardingPage() {
  const me = await currentUser();
  if (!me) redirect("/verify?role=merchant&new=1");
  if (me.session.role !== "merchant") redirect("/buyer?denied=merchant");
  const identity = me.identity;
  const claimed = !!identity.label && !!identity.shop?.provisionedAt;
  if (claimed && hasPassword(identity)) redirect(homeFor(identity));
  return <OnboardingFlow me={publicMe(identity, otherRole(me))} step={claimed ? "password" : "claim"} pendingName={identity.label || null} setupError={identity.shop?.error ?? null} />;
}
