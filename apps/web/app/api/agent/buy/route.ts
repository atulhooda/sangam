import { UntrustedPayeeError, assertFairInvoice, assertVerifiedPayee, resolveMerchant } from "@sangam/ens";
import { createPayingFetch, hashscanTxUrl } from "@sangam/hedera";
import { agentSigningKey, buyerBudgetAtomic, requireBuyer, spentByWallet } from "@/lib/server/buyer";
import { merchantEnsName, ondcGatewayName } from "@/lib/server/merchant";
import { findByTx } from "@/lib/server/store";
import type { Invoice } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * The buyer's agent buys from one merchant, by ENS name:
 *   1. resolve the name on ENS → the merchant's x402 URL
 *   2. read the 402 invoice; check it fits the buyer's budget and balance
 *   3. verified-merchants-only check: the invoice must pay the account in the
 *      merchant's ENS record, and the record must say sangam.status=verified
 *   4. sign the USDC transfer from the buyer's own agent wallet and retry
 * The merchant's paywall then notifies Sangam, which checks the chain, decides
 * with 0G, pays the merchant out on UPI and writes the HCS receipt.
 */
export async function POST(req: Request) {
  const me = await requireBuyer();
  if (!me) return Response.json({ error: "Sign in as a buyer first." }, { status: 401 });
  const wallet = me.identity.wallet;
  if (!wallet) return Response.json({ error: "Connect your agent wallet first." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { ensName?: string };
  const ensName = (body.ensName ?? "").trim().toLowerCase();
  if (!ensName) return Response.json({ error: "ensName is required" }, { status: 400 });

  let url: URL;
  try {
    url = new URL((await resolveMerchant(ensName)).endpoint);
    if (ensName === merchantEnsName()) {
      url.searchParams.set("from", "CSMT");
      url.searchParams.set("to", "PUNE");
    }
  } catch (err) {
    return Response.json({ error: `${ensName}: ${(err as Error).message.split("\n")[0]}` }, { status: 404 });
  }

  try {
    const probe = await fetch(url, { cache: "no-store" });
    const header = probe.headers.get("PAYMENT-REQUIRED");
    if (probe.status !== 402 || !header) throw new Error(`expected a 402 invoice from ${ensName}, got ${probe.status}`);
    const option = (JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Invoice).accepts[0];
    const price = BigInt(option?.amount ?? "0");
    // Who to pay and how much come from ENS; refuse a dishonest invoice before anything else.
    const guard = ensName === ondcGatewayName() ? assertVerifiedPayee : assertFairInvoice;
    if (option) await guard(option);

    const spent = spentByWallet(wallet.accountId);
    const limit = buyerBudgetAtomic();
    if (spent + price > limit) {
      return Response.json({ error: `Over your agent's budget: spent ${spent} of ${limit} (atomic USDC), this costs ${price}.` }, { status: 429 });
    }

    const { buy } = createPayingFetch({ accountId: wallet.accountId, privateKey: agentSigningKey(), guard });
    const purchase = await buy<Record<string, unknown>>(url);
    if (purchase.status >= 400 || !purchase.settle?.success) {
      const reason = (purchase.body as { error?: string } | null)?.error;
      return Response.json({ error: `${ensName} answered ${purchase.status}${reason ? `: ${reason}` : ""}. Is your wallet funded?` }, { status: 502 });
    }
    const tx = purchase.settle.transaction;
    return Response.json({
      ensName,
      priceAtomic: purchase.price,
      hederaTxId: tx,
      hashscan: hashscanTxUrl(tx),
      payTo: (purchase.payee as { payTo?: string } | undefined)?.payTo ?? null,
      result: purchase.body,
      settlement: findByTx(tx) ?? null,
    });
  } catch (err) {
    if (err instanceof UntrustedPayeeError) {
      return Response.json({ refused: true, reason: err.reason, error: err.message }, { status: 403 });
    }
    return Response.json({ error: (err as Error).message.split("\n")[0] }, { status: 502 });
  }
}
