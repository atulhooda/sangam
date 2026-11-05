import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, homeFor, otherRole, publicMe } from "@/lib/server/session";
import { CertForm } from "./cert-form";

export const metadata: Metadata = { title: "Merchant onboarding · Sangam" };
export const dynamic = "force-dynamic";

/** Step 2 of merchant sign-up: after the Self proof, the company certificate. */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ replace?: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/verify?role=merchant");
  if (me.session.role !== "merchant") redirect("/buyer?denied=merchant");
  const replacing = (await searchParams).replace === "1";
  if (me.identity.cert && me.identity.shop && !replacing) redirect(homeFor(me.identity));
  return <CertForm me={publicMe(me.identity, otherRole(me))} replacing={replacing && !!me.identity.cert} />;
}
