import { NextResponse, type NextRequest } from "next/server";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { withX402 } from "@x402/next";
import { createMerchantServer } from "@sangam/hedera";
import { MOCK_PROVIDER, confirm, init, type Line } from "@sangam/ondc";
import { env, formatUsdc, inrPerUsd, paiseToUsdcAtomic, type OndcOrderInfo, type SettlementNotice } from "@sangam/shared";
import { notifySangam, ondcGatewayName } from "@/lib/server/merchant";
import { ondcMerchantName, parseLine, quoteFor, releaseQuote, sellerApp } from "@/lib/server/ondc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * An agent buys real goods on ONDC with USDC:
 *
 *   unpaid  → ONDC select gives the seller's quote → 402 for that price in USDC
 *   paid    → ONDC init (seller's UPI settlement details), the facilitator
 *             settles the USDC to Sangam's treasury, THEN ONDC confirm, so
 *             the order is placed only once the money has landed
 *   then    → settlement notice to Sangam, which pays the seller in INR
 *
 *   GET /merchant/ondc/order?provider=annapurna-wholesale&item=atta-10kg&qty=1
 */

const DEFAULT_PROVIDER = MOCK_PROVIDER.id;
const server = createMerchantServer(() => undefined);

function lineOf(req: NextRequest | URLSearchParams): Line {
  const params = req instanceof URLSearchParams ? req : req.nextUrl.searchParams;
  const line = parseLine(params, DEFAULT_PROVIDER);
  if ("error" in line) throw new Error(line.error);
  return line;
}

/** Runs only after a valid payment is verified; settlement happens if this returns 200. */
async function handler(req: NextRequest): Promise<NextResponse<unknown>> {
  const line = lineOf(req);
  const held = await quoteFor(line);
  const initialized = await init(line, sellerApp(), held.transactionId);
  const upi = initialized.payment?.["@ondc/org/settlement_details"]?.[0]?.upi_address;
  if (!upi) return NextResponse.json({ error: "seller's on_init had no UPI settlement details" }, { status: 502 });
  return NextResponse.json({ stage: "initialized", transactionId: held.transactionId, quotePaise: held.quotePaise, sellerUpi: upi });
}

const paid = withX402(
  handler,
  {
    accepts: {
      scheme: "exact",
      network: "hedera:testnet",
      // ONDC: the buyer app collects the payment, so the USDC goes to Sangam's treasury.
      payTo: () => env("TREASURY_ACCOUNT_ID"),
      // Lets buyer agents check the payee against ENS before paying.
      extra: { ensName: ondcGatewayName() },
      price: async (ctx) => {
        const params = new URLSearchParams();
        for (const k of ["provider", "item", "qty"]) {
          const v = ctx.adapter.getQueryParam?.(k);
          if (typeof v === "string") params.set(k, v);
        }
        const held = await quoteFor(lineOf(params));
        return `$${formatUsdc(paiseToUsdcAtomic(held.quotePaise, await inrPerUsd()))}`;
      },
    },
    description: "ONDC order via Sangam, paid in USDC, seller settled in INR",
    mimeType: "application/json",
  },
  server,
);

export async function GET(req: NextRequest) {
  let line: Line;
  let held: Awaited<ReturnType<typeof quoteFor>>;
  try {
    line = lineOf(req);
    held = await quoteFor(line); // fail before the 402 if the item can't be quoted
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const res = await paid(req);
  const settleHeader = res.headers.get("PAYMENT-RESPONSE");
  if (res.status !== 200 || !settleHeader) return cors(res);

  // The USDC has settled. Now place the order with the seller.
  const settle = decodePaymentResponseHeader(settleHeader);
  const step = (await res.json()) as { transactionId: string; quotePaise: number; sellerUpi: string };
  const item = held.order.items[0];
  const name = held.order.quote?.breakup.find((b) => b["@ondc/org/title_type"] === "item")?.title ?? line.itemId;

  let ondc: OndcOrderInfo;
  try {
    const order = await confirm(line, sellerApp(), step.transactionId, { amountPaise: step.quotePaise, reference: settle.transaction });
    ondc = {
      transactionId: step.transactionId,
      orderId: order.id ?? "unknown",
      state: order.state ?? "Accepted",
      ...sellerApp(),
      providerId: line.providerId,
      providerName: order.provider.descriptor?.name ?? line.providerId,
      items: [{ id: line.itemId, name, count: item?.quantity.selected.count ?? line.count }],
      quoteInrPaise: step.quotePaise,
      sellerUpi: step.sellerUpi,
    };
  } catch (err) {
    // Paid but not confirmed: Sangam still records the money, and the pipeline holds it.
    ondc = {
      transactionId: step.transactionId,
      orderId: "not-confirmed",
      state: `confirm failed: ${(err as Error).message}`.slice(0, 200),
      ...sellerApp(),
      providerId: line.providerId,
      providerName: line.providerId,
      items: [{ id: line.itemId, name, count: line.count }],
      quoteInrPaise: step.quotePaise,
      sellerUpi: step.sellerUpi,
    };
  }
  releaseQuote(line);

  const notice: SettlementNotice = {
    merchant: ondcMerchantName(line.providerId),
    hederaTxId: settle.transaction,
    payer: settle.payer,
    usdcAmount: settle.amount ?? "0",
    quotedInrPaise: step.quotePaise,
    ondc,
  };
  await notifySangam(notice, "ondc");

  const out = NextResponse.json({ ondc, merchant: notice.merchant, hederaTxId: settle.transaction }, { status: ondc.state === "Accepted" ? 200 : 202 });
  out.headers.set("PAYMENT-RESPONSE", settleHeader);
  return cors(out);
}

function cors(res: Response) {
  res.headers.set("access-control-allow-origin", "*");
  res.headers.set("access-control-expose-headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  return res;
}
