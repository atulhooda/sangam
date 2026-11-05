// Dev only: send fake settlement notices so you can test settlement-agent and
// the dashboard without Hedera accounts. The agent must run with SKIP_CHAIN_VERIFY=true.
//   npm run simulate -- [count] [--short]
import { env, envOr, inrPerUsd, paiseToUsdcAtomic, resolveMerchant } from "@sangam/shared";

const count = Number(process.argv[2] ?? 1);
const short = process.argv.includes("--short"); // underpay by 10% to exercise the "hold" path
const merchantName = env("MERCHANT_ENS_NAME");
const merchant = await resolveMerchant(merchantName);
let atomic = paiseToUsdcAtomic(merchant.priceInrPaise, await inrPerUsd());
if (short) atomic = (atomic * 9n) / 10n;

for (let i = 0; i < count; i++) {
  const res = await fetch(`${envOr("SETTLEMENT_AGENT_URL", "http://localhost:3001")}/settlements`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sangam-key": env("SETTLEMENT_SHARED_SECRET") },
    body: JSON.stringify({
      merchant: merchantName,
      hederaTxId: `sim-0.0.1001@${Date.now()}.${i}`,
      payer: "0.0.1001",
      usdcAmount: atomic.toString(),
    }),
  });
  console.log(res.status, JSON.stringify(await res.json()).slice(0, 120));
}
