import type { Metadata } from "next";
import { DemoHeader } from "../../demo/shops/demo-header";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Merchant sign-in · Sangam" };

/**
 * Merchant sign-in with shop name + password: for merchants who proved who
 * they are with Self, claimed a name and set a password (and for Sangam's demo
 * shops). Signing in with Self again works too, from /verify.
 */
export default function MerchantLogin() {
  return (
    <div className="min-h-screen">
      <DemoHeader title="Merchant sign-in" />
      <main id="main" className="mx-auto max-w-md px-5 pb-20 pt-14">
        <LoginForm />
      </main>
    </div>
  );
}
