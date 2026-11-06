import type { Metadata } from "next";
import { DemoHeader } from "../../demo/shops/demo-header";
import { BuyerLoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Buyer sign-in · Sangam" };

/** Buyer sign-in with username + password (Sangam's demo buyers). Self works too, from /verify. */
export default function BuyerLogin() {
  return (
    <div className="min-h-screen">
      <DemoHeader title="Buyer sign-in" />
      <main id="main" className="mx-auto max-w-md px-5 pb-20 pt-14">
        <BuyerLoginForm />
      </main>
    </div>
  );
}
