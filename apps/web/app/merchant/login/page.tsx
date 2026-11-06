import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { demoLoginsEnabled } from "@/lib/server/demo-logins";
import { DemoHeader } from "../../demo/shops/demo-header";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demo merchant sign-in · Sangam" };

/** DEMO ONLY: username/password sign-in for Sangam's demo merchants. Real merchants use Self at /verify. */
export default function MerchantLogin() {
  if (!demoLoginsEnabled()) notFound();
  return (
    <div className="min-h-screen">
      <DemoHeader title="Demo merchant sign-in" />
      <main id="main" className="mx-auto max-w-md px-5 pb-20 pt-14">
        <LoginForm />
      </main>
    </div>
  );
}
