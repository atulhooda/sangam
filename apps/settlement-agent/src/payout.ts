import { randomUUID } from "node:crypto";
import { env, envOr } from "@sangam/shared";

export type PayoutRequest = { merchant: string; vpa: string; paise: number; reference: string };
export type PayoutResult = { ref: string; mode: "mock" | "razorpayx-test" };

/**
 * Pay the merchant in INR over UPI.
 *
 * PSP_MODE=mock (default) returns a fake reference.
 * PSP_MODE=razorpayx calls the RazorpayX composite payout API with test-mode
 * keys. Check the request body against the current RazorpayX docs before relying on it.
 */
export async function payout(req: PayoutRequest): Promise<PayoutResult> {
  const mode = envOr("PSP_MODE", "mock");
  if (mode === "mock") return { ref: `mockpout_${randomUUID().slice(0, 12)}`, mode: "mock" };
  if (mode !== "razorpayx") throw new Error(`unknown PSP_MODE "${mode}"`);

  const auth = Buffer.from(`${env("PSP_KEY_ID")}:${env("PSP_KEY_SECRET")}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/payouts", {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/json",
      "X-Payout-Idempotency": req.reference,
    },
    body: JSON.stringify({
      account_number: env("RAZORPAYX_ACCOUNT_NUMBER"),
      amount: req.paise,
      currency: "INR",
      mode: "UPI",
      purpose: "payout",
      queue_if_low_balance: true,
      reference_id: req.reference.slice(0, 40),
      narration: "Sangam settlement",
      fund_account: {
        account_type: "vpa",
        vpa: { address: req.vpa },
        contact: { name: req.merchant.slice(0, 50), type: "vendor", reference_id: req.merchant.slice(0, 40) },
      },
    }),
  });
  const body = (await res.json()) as { id?: string; error?: { description?: string } };
  if (!res.ok || !body.id) throw new Error(`RazorpayX payout failed: ${body.error?.description ?? res.status}`);
  return { ref: body.id, mode: "razorpayx-test" };
}
