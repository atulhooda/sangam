import { constants, publicEncrypt, randomUUID } from "node:crypto";
import { env, envOr } from "./config.ts";
import type { PayoutMode } from "./types.ts";

export type PayoutRequest = { merchant: string; vpa: string; paise: number; reference: string };
export type PayoutResult = {
  ref: string;
  mode: PayoutMode;
  /** Cashfree sandbox only accepts its test UPI IDs: the one actually paid, standing in for the merchant's. */
  paidTo?: string;
  /** The PSP's status for the transfer (e.g. RECEIVED, PENDING, SUCCESS). */
  status?: string;
};

/**
 * Pay the merchant in INR over UPI.
 *
 * PSP_MODE=mock (default) returns a fake reference.
 * PSP_MODE=cashfree calls Cashfree Payouts (Standard Transfer V2): sandbox
 * by default, production with CASHFREE_ENV=production.
 * PSP_MODE=razorpayx calls the RazorpayX composite payout API with test-mode
 * keys. Check the request body against the current RazorpayX docs before relying on it.
 */
export async function payout(req: PayoutRequest, opts: { forceMock?: boolean } = {}): Promise<PayoutResult> {
  const mode = opts.forceMock ? "mock" : envOr("PSP_MODE", "mock");
  if (mode === "mock") return { ref: `mockpout_${randomUUID().slice(0, 12)}`, mode: "mock" };
  if (mode === "cashfree") return cashfreePayout(req);
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
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { id?: string; error?: { description?: string } };
  if (!res.ok || !body.id) throw new Error(`RazorpayX payout failed: ${body.error?.description ?? res.status}`);
  return { ref: body.id, mode: "razorpayx-test" };
}

/* ── Cashfree Payouts (Standard Transfer V2) ───────────────────────────── */

const cashfreeBase = () =>
  envOr("CASHFREE_ENV", "sandbox") === "production" ? "https://api.cashfree.com/payout" : "https://sandbox.cashfree.com/payout";
const cashfreeSandbox = () => envOr("CASHFREE_ENV", "sandbox") !== "production";

/** Cashfree's sandbox only pays its test UPI IDs (success@upi / failure@upi); real IDs fail there. */
const SANDBOX_VPA = () => envOr("CASHFREE_SANDBOX_VPA", "success@upi");

/**
 * Cashfree only accepts payout calls from whitelisted IPs, or with a
 * signature from its 2FA public key (Developers → Two-Factor Authentication →
 * Public Key). Railway has no fixed IP, so Sangam signs: RSA-OAEP encrypt
 * "<clientId>.<unix seconds>" with that key, base64, as X-Cf-Signature.
 */
function cashfreeSignature(clientId: string): string | null {
  const raw = process.env.CASHFREE_PUBLIC_KEY?.trim();
  if (!raw) return null;
  const pem = raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : `-----BEGIN PUBLIC KEY-----\n${raw.replace(/\s+/g, "")}\n-----END PUBLIC KEY-----`;
  const plain = Buffer.from(`${clientId}.${Math.floor(Date.now() / 1000)}`);
  return publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING }, plain).toString("base64");
}

function cashfreeHeaders(): Record<string, string> {
  const clientId = env("CASHFREE_CLIENT_ID");
  const signature = cashfreeSignature(clientId);
  return {
    "x-client-id": clientId,
    "x-client-secret": env("CASHFREE_CLIENT_SECRET"),
    "x-api-version": envOr("CASHFREE_API_VERSION", "2024-01-01"),
    "content-type": "application/json",
    ...(signature ? { "x-cf-signature": signature } : {}),
  };
}

type CashfreeTransfer = { transfer_id?: string; cf_transfer_id?: string; status?: string; status_code?: string; status_description?: string; transfer_utr?: string; message?: string; code?: string };

/**
 * Pay the merchant over UPI through Cashfree. In sandbox the transfer goes to
 * Cashfree's test UPI ID (success@upi) in place of the merchant's real one,
 * and the result says so (paidTo). Waits briefly for a final status; a
 * transfer still in flight is recorded as such, a failed one throws.
 */
async function cashfreePayout(req: PayoutRequest): Promise<PayoutResult> {
  const sandbox = cashfreeSandbox();
  const vpa = sandbox ? SANDBOX_VPA() : req.vpa;
  // Cashfree: transfer_id up to 40 chars of letters, digits and underscores; amount in rupees.
  const transferId = `SNG_${req.reference.replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 40);
  const res = await fetch(`${cashfreeBase()}/transfers`, {
    method: "POST",
    headers: cashfreeHeaders(),
    body: JSON.stringify({
      transfer_id: transferId,
      transfer_amount: Math.round(req.paise) / 100,
      transfer_currency: "INR",
      transfer_mode: "upi",
      beneficiary_details: {
        beneficiary_name: req.merchant.replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Sangam merchant",
        beneficiary_instrument_details: { vpa },
      },
      transfer_remarks: "Sangam settlement",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  let body = (await res.json().catch(() => ({}))) as CashfreeTransfer;
  if (!res.ok) throw new Error(`Cashfree payout ${res.status}: ${body.message ?? body.code ?? JSON.stringify(body).slice(0, 200)}`);

  // Async by default: check the status a few times for a final answer.
  for (let i = 0; i < 4 && !["SUCCESS", "FAILED", "REJECTED", "REVERSED"].includes(body.status ?? ""); i++) {
    await new Promise((r) => setTimeout(r, 1_500));
    const s = await fetch(`${cashfreeBase()}/transfers?transfer_id=${encodeURIComponent(transferId)}`, { headers: cashfreeHeaders(), signal: AbortSignal.timeout(10_000) });
    if (s.ok) body = { ...body, ...((await s.json()) as CashfreeTransfer) };
  }
  if (["FAILED", "REJECTED", "REVERSED"].includes(body.status ?? "")) {
    throw new Error(`Cashfree payout ${body.status}: ${body.status_code ?? ""} ${body.status_description ?? ""}`.trim());
  }
  const ref = body.transfer_utr || body.cf_transfer_id || transferId;
  return { ref, mode: sandbox ? "cashfree-sandbox" : "cashfree", status: body.status, ...(sandbox ? { paidTo: vpa } : {}) };
}

/** Cheap credentials check for the dashboard/setup: a status lookup of a transfer that doesn't exist. */
export async function cashfreeReachable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await fetch(`${cashfreeBase()}/transfers?transfer_id=SNG_PING`, { headers: cashfreeHeaders(), signal: AbortSignal.timeout(8_000) });
    const b = (await r.json().catch(() => ({}))) as CashfreeTransfer;
    // 404 transfer_id_not_found means the keys were accepted.
    return { ok: r.status === 404 || r.ok, detail: `${r.status} ${b.code ?? b.status ?? ""} ${b.message ?? ""}`.trim() };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
