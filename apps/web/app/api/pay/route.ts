import { resolveMerchant } from "@sangam/ens";
import { createPayingFetch, hashscanTxUrl } from "@sangam/hedera";
import { merchantEnsName, type Ticket } from "@/lib/server/merchant";
import { canPayAsAgent } from "@/lib/server/pipeline";
import { findByTx } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Pay as agent": a buyer agent running on the server with the CUSTOMER_* key.
 * It finds the merchant by ENS name, gets the 402, signs a real testnet USDC
 * transfer and retries, with no approval step per payment. The merchant's
 * notice then starts the settlement, which this returns so the dashboard can
 * follow it.
 */
export async function POST() {
  if (!canPayAsAgent()) {
    return Response.json({ error: "Set CUSTOMER_ACCOUNT_ID, CUSTOMER_PRIVATE_KEY and SETTLEMENT_SHARED_SECRET in .env" }, { status: 412 });
  }
  const merchant = await resolveMerchant(merchantEnsName());
  const url = new URL(merchant.endpoint);
  url.searchParams.set("from", "CSMT");
  url.searchParams.set("to", "PUNE");

  try {
    const { buy } = createPayingFetch();
    const purchase = await buy<Ticket>(url);
    if (purchase.status !== 200 || !purchase.settle?.success) {
      return Response.json({ error: `merchant answered ${purchase.status}`, detail: purchase.body }, { status: 502 });
    }
    const tx = purchase.settle.transaction;
    return Response.json({
      ticket: purchase.body,
      hederaTxId: tx,
      hashscan: hashscanTxUrl(tx),
      priceAtomic: purchase.price,
      settlement: findByTx(tx) ?? null,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
