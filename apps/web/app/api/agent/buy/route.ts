import type { PaymentRequirements } from "@x402/core/types";
import { envOr } from "@sangam/shared";
import { HEDERA_NETWORK } from "@sangam/hedera";
import { UntrustedPayeeError, assertFairInvoice, assertVerifiedPayee, resolveMerchant } from "@sangam/ens";

import { BadBuyUrlError, assertUrlMerchantOrigin, parseAgentUrl } from "@/lib/server/buy-url";
import { agentSigningKey, buyerBudgetAtomic, requireBuyer, spentByWallet } from "@/lib/server/buyer";
import { createAgentBuyer, explorerUrl } from "@/lib/server/rails";
import { merchantEnsName, ondcGatewayName } from "@/lib/server/merchant";
import { findByTx } from "@/lib/server/store";
import { walletBuy } from "@/lib/server/wallet-buy";
import type { Invoice } from "@/lib/types";
import { publicOrigin } from "@/lib/server/origin";

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
  const body = (await req.json().catch(() => ({}))) as { ensName?: string; url?: string; rail?: string };
  // From the buyer's own MetaMask (Sepolia), by ENS name: see lib/server/wallet-buy.ts.
  if (body.rail === "sepolia") return walletBuy(me, body, publicOrigin(req));

  const wallet = me.identity.wallet;
  if (!wallet) return Response.json({ error: "Connect your agent wallet first." }, { status: 400 });

  const agent = (guard?: Parameters<typeof createAgentBuyer>[0]["guard"], memo?: string) =>
    createAgentBuyer({
      hedera: { accountId: wallet.accountId, privateKey: agentSigningKey() },
      maxPerPayment: envOr("CUSTOMER_MAX_PER_PAYMENT", "$1"),
      guard,
      memo,
    });

  // Either a merchant by ENS name, or a buyer-pasted link (vetted the same way
  // /api/pay vets it, so the two routes can't drift).
  let url: URL;
  let ensName: string | null = null;
  let target: string;
  if ((body.url ?? "").trim()) {
    try {
      url = await parseAgentUrl(body.url!.trim(), publicOrigin(req));
    } catch (err) {
      if (err instanceof BadBuyUrlError) return Response.json({ error: err.message }, { status: 422 });
      throw err;
    }
    target = url.host;
  } else {
    ensName = (body.ensName ?? "").trim().toLowerCase();
    if (!ensName) return Response.json({ error: "ensName or url is required" }, { status: 400 });
    target = ensName;
    try {
      url = new URL((await resolveMerchant(ensName)).endpoint);
      if (ensName === merchantEnsName()) {
        url.searchParams.set("from", "CSMT");
        url.searchParams.set("to", "PUNE");
      }
    } catch (err) {
      return Response.json({ error: `${ensName}: ${(err as Error).message.split("\n")[0]}` }, { status: 404 });
    }
  }

  try {
    const probe = await fetch(url, { cache: "no-store" });
    const header = probe.headers.get("PAYMENT-REQUIRED");
    if (probe.status !== 402 || !header) throw new Error(`expected a 402 invoice from ${target}, got ${probe.status}`);
    const option = ((JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Invoice).accepts as never as PaymentRequirements[]).find((a) => a.network === HEDERA_NETWORK);
    const price = BigInt(option?.amount ?? "0");
    // Who to pay and how much come from ENS; refuse a dishonest invoice before anything else.
    const guard = ensName === ondcGatewayName() ? assertVerifiedPayee : assertFairInvoice;
    if (option) await guard(option);
    if (ensName === null && option) await assertUrlMerchantOrigin(url, option);

    const spent = spentByWallet(wallet.accountId);
    const limit = buyerBudgetAtomic();
    if (spent + price > limit) {
      return Response.json({ error: `Over your agent's budget: spent ${spent} of ${limit} (atomic USDC), this costs ${price}.` }, { status: 429 });
    }

    // On-chain proof the payment was agentic: the memo rides in the signed
    // transfer and shows on HashScan. 100 bytes max.
    const { buy } = agent(guard, `Sangam AI agent | x402 | ${target} | buyer ${wallet.accountId}`);
    let purchase = await buy<Record<string, unknown>>(url);
    if (purchase.status === 402) {
      // A top-up from seconds ago may not be visible to the facilitator's
      // mirror-node view yet; one short retry covers "funded, then bought
      // immediately" instead of failing with a confusing 402.
      await new Promise((r) => setTimeout(r, 4_000));
      purchase = await buy<Record<string, unknown>>(url);
    }
    if (purchase.status >= 400 || !purchase.settle?.success) {
      const reason = (purchase.body as { error?: string } | null)?.error;
      return Response.json({ error: `${target} answered ${purchase.status}${reason ? `: ${reason}` : ""}. Is your wallet funded?` }, { status: 502 });
    }
    const tx = purchase.settle.transaction;
    return Response.json({
      ensName: ensName ?? undefined,
      url: ensName === null ? url.toString() : undefined,
      priceAtomic: purchase.price,
      hederaTxId: tx,
      hashscan: explorerUrl(tx),
      explorer: explorerUrl(tx),
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
