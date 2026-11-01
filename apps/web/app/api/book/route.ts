import {
  FACILITATOR_FEE_PAYER,
  HEDERA_TESTNET_USDC,
  MERCHANT_ENS_NAME,
  inrPerUsd,
  paiseToUsdcAtomic,
  resolveMerchant,
} from "@/lib/server/money";

export const dynamic = "force-dynamic";

/**
 * The merchant's paywalled endpoint. Unpaid, it answers 402 Payment Required
 * with an x402 v2 invoice, base64-encoded in the PAYMENT-REQUIRED header (the
 * same shape the old @x402/express middleware produced).
 *
 * Not yet wired: accepting an X-PAYMENT proof and settling it via the
 * facilitator. Until that is ported, every request gets the 402.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const m = resolveMerchant(MERCHANT_ENS_NAME);
  const amount = paiseToUsdcAtomic(m.priceInrPaise, await inrPerUsd()).toString();
  const invoice = {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: url.toString(),
      description: `Rail ticket from ${m.ensName}, ₹${m.priceInrPaise / 100}`,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: m.network,
        amount,
        asset: HEDERA_TESTNET_USDC,
        payTo: m.hederaPayTo,
        maxTimeoutSeconds: 300,
        extra: { feePayer: FACILITATOR_FEE_PAYER },
      },
    ],
  };
  return new Response("{}", {
    status: 402,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(invoice)).toString("base64"),
      "access-control-expose-headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
    },
  });
}
