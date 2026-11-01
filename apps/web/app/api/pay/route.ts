import { resolveMerchant } from "@sangam/ens";
import { createPayingFetch, hashscanTxUrl } from "@sangam/hedera";
import { merchantEnsName } from "@/lib/server/merchant";
import { canPayAsAgent } from "@/lib/server/pipeline";
import { findByTx } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Pay as agent": a buyer agent running on the server with the CUSTOMER_* key.
 * No approval step per payment: it gets the 402, signs real testnet USDC and
 * retries.
 *
 *   { kind: "ticket" }  finds tickets.sangam.eth on ENS and buys a rail ticket
 *   { kind: "ondc", q: "atta", qty: 1 }  searches ONDC through Sangam and
 *                                        buys the first match
 */
export async function POST(req: Request) {
  if (!canPayAsAgent()) {
    return Response.json({ error: "Set CUSTOMER_ACCOUNT_ID, CUSTOMER_PRIVATE_KEY and SETTLEMENT_SHARED_SECRET in .env" }, { status: 412 });
  }
  const body = (await req.json().catch(() => ({}))) as { kind?: "ticket" | "ondc"; q?: string; qty?: number };
  const origin = new URL(req.url).origin;

  let url: URL;
  let what: string;
  if (body.kind === "ondc") {
    const res = await fetch(`${origin}/merchant/ondc/catalog?q=${encodeURIComponent(body.q ?? "atta")}`, { cache: "no-store" });
    const catalog = (await res.json()) as { results?: { name: string; orderUrl: string }[]; error?: string };
    const hit = catalog.results?.[0];
    if (!hit) return Response.json({ error: catalog.error ?? `nothing on ONDC matches "${body.q ?? "atta"}"` }, { status: 404 });
    url = new URL(hit.orderUrl);
    url.searchParams.set("qty", String(Math.max(1, Math.min(50, Math.floor(body.qty ?? 1)))));
    what = hit.name;
  } else {
    const merchant = await resolveMerchant(merchantEnsName());
    url = new URL(merchant.endpoint);
    url.searchParams.set("from", "CSMT");
    url.searchParams.set("to", "PUNE");
    what = "rail ticket";
  }

  try {
    const { buy } = createPayingFetch();
    const purchase = await buy<Record<string, unknown>>(url);
    if (purchase.status >= 400 || !purchase.settle?.success) {
      return Response.json({ error: `merchant answered ${purchase.status}`, detail: purchase.body }, { status: 502 });
    }
    const tx = purchase.settle.transaction;
    return Response.json({
      kind: body.kind ?? "ticket",
      bought: what,
      result: purchase.body,
      ticket: body.kind === "ondc" ? undefined : purchase.body,
      hederaTxId: tx,
      hashscan: hashscanTxUrl(tx),
      priceAtomic: purchase.price,
      settlement: findByTx(tx) ?? null,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
