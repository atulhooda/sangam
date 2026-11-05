import express from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HEDERA_TESTNET_USDC, HEDERA_USDC_DECIMALS } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import {
  env,
  envOr,
  formatUsdc,
  inrPerUsd,
  paiseToUsdcAtomic,
  resolveMerchant,
  type SettlementNotice,
} from "@sangam/shared";
import { KNOWN_ROUTES, bookTicket } from "./service.ts";

const merchantName = env("MERCHANT_ENS_NAME");
const merchant = await resolveMerchant(merchantName);
const network = merchant.network as `${string}:${string}`;
const usdcTokenId = envOr("HEDERA_USDC_TOKEN_ID", HEDERA_TESTNET_USDC);
const settlementUrl = envOr("SETTLEMENT_AGENT_URL", "http://localhost:3001");

async function currentPriceUsd(): Promise<string> {
  const atomic = paiseToUsdcAtomic(merchant.priceInrPaise, await inrPerUsd());
  return `$${formatUsdc(atomic)}`;
}

const facilitator = new HTTPFacilitatorClient({
  url: envOr("FACILITATOR_URL", "https://api.testnet.blocky402.com"),
});

const resourceServer = new x402ResourceServer(facilitator).register(
  "hedera:*",
  new ExactHederaScheme({
    defaultAssets: { [network]: { asset: usdcTokenId, decimals: HEDERA_USDC_DECIMALS } },
  }),
);

// Hand every settled payment to the settlement agent. Fire-and-forget: the
// buyer already paid, so they get their ticket even if this call fails.
resourceServer.onAfterSettle(async ({ result, requirements }) => {
  if (!result.success) return;
  const notice: SettlementNotice = {
    merchant: merchantName,
    hederaTxId: result.transaction,
    payer: result.payer,
    usdcAmount: result.amount ?? requirements.amount,
  };
  console.log(`[merchant] settled ${notice.hederaTxId} for ${formatUsdc(notice.usdcAmount)} USDC`);
  fetch(`${settlementUrl}/settlements`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sangam-key": env("SETTLEMENT_SHARED_SECRET") },
    body: JSON.stringify(notice),
  }).catch((err) => console.error(`[merchant] could not notify settlement agent: ${err.message}`));
});

const app = express();

// Let a dashboard on another origin read the quote and the 402 invoice headers.
app.use((_req, res, next) => {
  res.setHeader("access-control-allow-origin", envOr("DASHBOARD_ORIGIN", "*"));
  res.setHeader("access-control-expose-headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, merchant: merchantName });
});

// Free price check, so an agent can decide before paying.
app.get("/quote", async (_req, res) => {
  res.json({
    merchant: merchantName,
    priceInr: merchant.priceInrPaise / 100,
    priceUsdc: (await currentPriceUsd()).slice(1),
    network,
    payTo: merchant.hederaPayTo,
    upiHandle: merchant.upiHandle,
    routes: KNOWN_ROUTES,
  });
});

app.use(
  paymentMiddleware(
    {
      "GET /book": {
        accepts: {
          scheme: "exact",
          network,
          payTo: merchant.hederaPayTo,
          price: currentPriceUsd,
        },
        description: `Rail ticket from ${merchantName}, ₹${merchant.priceInrPaise / 100}`,
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/book", (req, res) => {
  const from = String(req.query.from ?? "CSMT");
  const to = String(req.query.to ?? "PUNE");
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  res.json(bookTicket({ from, to, date }));
});

const port = Number(process.env.PORT || envOr("MERCHANT_API_PORT", "3000"));
app.listen(port, () => {
  console.log(`[merchant] ${merchantName} listening on :${port}, payTo ${merchant.hederaPayTo} on ${network}`);
});
