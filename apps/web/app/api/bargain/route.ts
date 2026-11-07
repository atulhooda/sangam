import { NextResponse, type NextRequest } from "next/server";
import { negotiate } from "@sangam/og";
import { flag } from "@sangam/shared";
import { DEFAULT_BARGAIN_BPS, resolveMerchant } from "@sangam/ens";
import { requireBuyer } from "@/lib/server/buyer";
import { createBoloInvoice } from "@/lib/server/bolo";
import { publicOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * Agent-to-agent bargaining. The buyer agent asks for a merchant's price, the
 * merchant's agent opens at list + margin, and the two haggle (0G Compute, or
 * the deterministic fallback) within the merchant's published ± margin
 * (sangam.bargain, default ±5%). Because the agreed price always lands inside
 * that merchant-published band, the buyer agent's fair-invoice check
 * (assertFairInvoice, whose ceiling is the ENS price + the same published
 * margin) still passes on the final invoice.
 *
 * On a deal we mint a Bolo-style invoice at the agreed price (pinned to HCS
 * with the transcript) and return its pay link, so the buyer pays it through
 * the same pipeline as any other Sangam payment: Hedera → 0G decision → UPI
 * payout → HCS receipt.
 */
export async function POST(req: NextRequest) {
  const me = await requireBuyer();
  if (!me) return NextResponse.json({ error: "Sign in as a buyer first." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { ensName?: string };
  const ensName = (body.ensName ?? "").trim().toLowerCase();
  if (!ensName) return NextResponse.json({ error: "ensName is required" }, { status: 400 });

  let record;
  try {
    record = await resolveMerchant(ensName);
  } catch (err) {
    return NextResponse.json({ error: `Could not read ${ensName} from ENS (${(err as Error).message.split("\n")[0]}).` }, { status: 404 });
  }
  if (record.status !== "verified") {
    return NextResponse.json({ error: `Won't bargain with ${ensName}: it is not a verified Sangam merchant.` }, { status: 403 });
  }

  const listPaise = record.priceInrPaise;
  const bargainBps = record.bargainBps ?? DEFAULT_BARGAIN_BPS;
  const result = await negotiate({ product: ensName, listPaise, bargainBps });

  // Mint the agreed-price invoice and pin the haggle to consensus.
  const transcript = result.rounds.map((r) => `${r.by === "merchant" ? "Merchant" : "Buyer"}: ${r.message}`).join("\n");
  const invoice = await createBoloInvoice({
    merchant: ensName,
    buyerName: me.identity.disclosed?.name || "AI buyer agent",
    amountPaise: result.agreedPaise,
    dueDays: null,
    note: `Bargained ₹${(result.askPaise / 100).toFixed(2)} → ₹${(result.agreedPaise / 100).toFixed(2)} (saved ${(result.savedBps / 100).toFixed(1)}%, list ₹${(listPaise / 100).toFixed(2)})`,
    transcript,
  });

  return NextResponse.json({
    ensName,
    listPaise: result.listPaise,
    askPaise: result.askPaise,
    floorPaise: result.floorPaise,
    agreedPaise: result.agreedPaise,
    savedPaise: result.savedPaise,
    savedBps: result.savedBps,
    vsListPaise: result.vsListPaise,
    bargainBps,
    usedModel: result.usedModel,
    rounds: result.rounds,
    // What decided the offers, so the UI can show the 0G Compute engine honestly.
    og: {
      live: !flag("OG_MOCK"),
      turns: result.ogTurns,
      verified: result.usedModel,
      provider: process.env.OG_PROVIDER_ADDRESS ?? null,
    },
    invoiceId: invoice.id,
    payUrl: `${publicOrigin(req)}/api/bolo/invoice/${invoice.id}`,
  });
}
