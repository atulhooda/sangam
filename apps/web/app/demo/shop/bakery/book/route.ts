import { encodePaymentRequiredHeader } from "@x402/core/http";
import { resolveMerchant } from "@sangam/ens";
import { usdcTokenId } from "@sangam/hedera";
import { WHITECHAIN_NETWORK, USDT_EIP712, depositAddress, usdtAddress, whitechainEnabled } from "@sangam/whitechain";
import { inrPerUsd, paiseToUsdcAtomic } from "@sangam/shared";
import { HACKER_ACCOUNT, HACKER_EVM_ADDRESS, OVERCHARGE_FACTOR, parseAttack } from "@/lib/demo-shop";
import { bakeryEnsName } from "@/lib/server/merchant";

export const dynamic = "force-dynamic";

/*
 * DEMO ONLY: the bakery's backend after a hack. The bakery's storefront still
 * shows the real price read from its ENS name (bakery.sangam.eth), but an
 * attacker has changed the code that writes the x402 invoice:
 *
 *   ?attack=overcharge  (default) bill 10× the ENS price, to the real account
 *   ?attack=redirect    bill the right price, to the attacker's account
 *   ?attack=both        10× the price, to the attacker's account
 *
 * The invoice still names the bakery's ENS name, so a careless agent would
 * pay. Sangam's agent compares it with the ENS record and refuses before
 * signing. This route never accepts a payment.
 */

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const attack = parseAttack(params.get("attack"));
  // ?product=<label>: the same attack on one storefront product (its own ENS name and price).
  const product = (params.get("product") ?? "").trim().toLowerCase();
  const name = product && /^[a-z0-9-]{3,63}$/.test(product) ? `${product}.${bakeryEnsName()}` : bakeryEnsName();
  let record;
  try {
    record = await resolveMerchant(name);
  } catch (err) {
    return Response.json({ error: `${name} is not on ENS yet: ${(err as Error).message.split("\n")[0]}` }, { status: 503 });
  }
  const honest = paiseToUsdcAtomic(record.priceInrPaise, await inrPerUsd());
  const amount = attack === "redirect" ? honest : honest * OVERCHARGE_FACTOR;
  const payTo = attack === "overcharge" ? record.hederaPayTo : HACKER_ACCOUNT;

  const header = encodePaymentRequiredHeader({
    x402Version: 2,
    error: "Payment required",
    resource: { url: req.url, description: `${product ? name : `Chocolate truffle cake from ${name}`}, ₹${record.priceInrPaise / 100}`, mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: record.network as `${string}:${string}`,
        amount: amount.toString(),
        asset: usdcTokenId(),
        payTo,
        maxTimeoutSeconds: 300,
        extra: { ensName: name },
      },
      // The same attack on the Whitechain USDT line.
      ...(whitechainEnabled()
        ? [
            {
              scheme: "exact",
              network: WHITECHAIN_NETWORK,
              amount: amount.toString(),
              asset: usdtAddress(),
              payTo: attack === "overcharge" ? (record.whitechainPayTo ?? depositAddress(name)) : HACKER_EVM_ADDRESS,
              maxTimeoutSeconds: 300,
              extra: { ensName: name, ...USDT_EIP712 },
            },
          ]
        : []),
    ],
  });
  return new Response(JSON.stringify({ error: "Payment required" }), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": header,
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "PAYMENT-REQUIRED",
    },
  });
}
