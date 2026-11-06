import { UntrustedPayeeError, assertFairInvoice, assertVerifiedPayee, resolveMerchant } from "@sangam/ens";
import { createPayingFetch, hashscanTxUrl } from "@sangam/hedera";
import { assertBudgetAllows, BudgetExceededError, budgetSnapshot, recordBudgetSpend } from "@/lib/server/budget";
import { parseAttack } from "@/lib/demo-shop";
import { merchantEnsName } from "@/lib/server/merchant";
import { canPayAsAgent } from "@/lib/server/pipeline";
import { currentUser } from "@/lib/server/session";
import { findByTx } from "@/lib/server/store";
import type { Invoice } from "@/lib/types";

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
 *   { kind: "scam" }    tries a fake IRCTC site that impersonates
 *                       tickets.sangam.eth: the agent must refuse it
 *   { kind: "hacked" }  tries the demo bakery whose backend was hacked to
 *                       bill 10× its ENS price (or pay another account):
 *                       the agent must refuse it
 *
 * The agent only pays verified Sangam merchants: before signing, every
 * invoice is checked against the merchant's ENS record: who to pay
 * (assertVerifiedPayee) and, for fixed-price merchants, how much
 * (assertFairInvoice). ONDC orders are priced per order, so they get the first.
 */
export async function POST(req: Request) {
  // The agent spends real (testnet) USDC: only a Self-verified buyer may start it.
  const me = await currentUser();
  if (!me || me.session.role !== "user") {
    return Response.json({ error: "Sign in as a buyer with Self to pay as the agent.", signIn: "/verify?role=user" }, { status: 401 });
  }
  if (!canPayAsAgent()) {
    return Response.json({ error: "Set CUSTOMER_ACCOUNT_ID, CUSTOMER_PRIVATE_KEY and SETTLEMENT_SHARED_SECRET in .env" }, { status: 412 });
  }
  const body = (await req.json().catch(() => ({}))) as { kind?: "ticket" | "ondc" | "scam" | "hacked"; attack?: string; q?: string; qty?: number };
  const origin = new URL(req.url).origin;

  let url: URL;
  let what: string;
  if (body.kind === "scam") {
    url = new URL(`${origin}/demo/fake-irctc?from=CSMT&to=PUNE`);
    what = "a ticket from a fake IRCTC site";
  } else if (body.kind === "hacked") {
    url = new URL(`${origin}/demo/shop/bakery/book?attack=${parseAttack(body.attack)}`);
    what = "a cake from the hacked bakery";
  } else if (body.kind === "ondc") {
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
    // Enforce the cumulative budget before signing anything: probe the 402 for
    // the price, then refuse if it wouldn't fit in what's left.
    const probe = await fetch(url, { cache: "no-store" });
    const probeHeader = probe.headers.get("PAYMENT-REQUIRED");
    if (probe.status !== 402 || !probeHeader) throw new Error(`expected 402 from merchant, got ${probe.status}`);
    const option = (JSON.parse(atob(probeHeader)) as Invoice).accepts[0];
    if (!option?.amount) throw new Error("merchant returned no payment options");
    // ENS first: a dishonest invoice is refused for what it is, whatever the budget.
    const guard = body.kind === "ondc" ? assertVerifiedPayee : assertFairInvoice;
    await guard(option);
    await assertBudgetAllows(BigInt(option.amount));

    const { buy } = createPayingFetch({ guard });
    const purchase = await buy<Record<string, unknown>>(url);
    if (purchase.status >= 400 || !purchase.settle?.success) {
      return Response.json({ error: `merchant answered ${purchase.status}`, detail: purchase.body }, { status: 502 });
    }
    const tx = purchase.settle.transaction;
    await recordBudgetSpend(tx, purchase.price);
    return Response.json({
      kind: body.kind ?? "ticket",
      bought: what,
      result: purchase.body,
      ticket: body.kind === "ondc" ? undefined : purchase.body,
      hederaTxId: tx,
      hashscan: hashscanTxUrl(tx),
      priceAtomic: purchase.price,
      budget: await budgetSnapshot(),
      settlement: findByTx(tx) ?? null,
    });
  } catch (err) {
    if (err instanceof UntrustedPayeeError) {
      // Nothing was signed or paid.
      return Response.json({ refused: true, kind: body.kind ?? "ticket", reason: err.reason, error: err.message, target: url.toString() }, { status: 403 });
    }
    if (err instanceof BudgetExceededError) {
      return Response.json(
        {
          error: `${err.message}. Top up CUSTOMER_TOTAL_BUDGET or raise it in .env.`,
          spentAtomic: err.spentAtomic,
          limitAtomic: err.limitAtomic,
          remainingAtomic: err.remainingAtomic,
        },
        { status: 429 },
      );
    }
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
