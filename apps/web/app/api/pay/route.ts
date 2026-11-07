import type { PaymentRequirements } from "@x402/core/types";
import { UntrustedPayeeError, assertFairInvoice, assertVerifiedPayee, resolveMerchant } from "@sangam/ens";
import { HEDERA_NETWORK } from "@sangam/hedera";
import { env, envOr } from "@sangam/shared";
import { assertBudgetAllows, BudgetExceededError, budgetSnapshot, recordBudgetSpend } from "@/lib/server/budget";
import { BadBuyUrlError, assertUrlMerchantOrigin, parseAgentUrl } from "@/lib/server/buy-url";
import { parseAttack } from "@/lib/demo-shop";
import { merchantEnsName } from "@/lib/server/merchant";
import { canPayAsAgent } from "@/lib/server/pipeline";
import { currentUser } from "@/lib/server/session";
import { createAgentBuyer, explorerUrl } from "@/lib/server/rails";
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
 *   { kind: "url", url }  tries an x402 purchase at a buyer-pasted link. The
 *                       link is vetted (https, public, resolvable) and the
 *                       invoice must pass the same ENS checks plus an
 *                       origin check: the page must live on the merchant's
 *                       registered ENS endpoint.
 *
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
  const body = (await req.json().catch(() => ({}))) as {
    kind?: "ticket" | "ondc" | "scam" | "hacked" | "url";
    attack?: string;
    q?: string;
    qty?: number;
    url?: string;
    product?: string;
  };
  const agent = (guard?: Parameters<typeof createAgentBuyer>[0]["guard"], memo?: string) =>
    createAgentBuyer({
      hedera: { accountId: env("CUSTOMER_ACCOUNT_ID"), privateKey: env("CUSTOMER_PRIVATE_KEY") },
      maxPerPayment: envOr("CUSTOMER_MAX_PER_PAYMENT", "$1"),
      guard,
      memo,
    });
  const origin = new URL(req.url).origin;

  let url: URL;
  let what: string;
  if (body.kind === "scam") {
    url = new URL(`${origin}/demo/fake-irctc?from=CSMT&to=PUNE`);
    what = "a ticket from a fake IRCTC site";
  } else if (body.kind === "hacked") {
    url = new URL(`${origin}/demo/shop/bakery/book?attack=${parseAttack(body.attack)}`);
    // One storefront product instead of the whole shop (its own ENS name and price).
    if (typeof body.product === "string" && /^[a-z0-9-]{3,63}$/.test(body.product)) url.searchParams.set("product", body.product);
    what = "a cake from the hacked bakery";
  } else if (body.kind === "url") {
    const raw = (body.url ?? "").trim();
    if (!raw) return Response.json({ error: "Paste a website link for the agent to buy from." }, { status: 400 });
    try {
      url = await parseAgentUrl(raw, origin);
    } catch (err) {
      if (err instanceof BadBuyUrlError) return Response.json({ error: err.message }, { status: 422 });
      throw err;
    }
    what = "an x402 purchase from " + url.host;
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
    if (probe.status !== 402 || !probeHeader) {
      if (body.kind === "url") {
        // A normal website, not an x402 paywall: a friendly answer, not an error.
        return Response.json(
          {
            notX402: true,
            error: `${url.host} doesn't speak x402 — it answered ${probe.status} with no PAYMENT-REQUIRED invoice, so there is nothing for the agent to sign. Nothing was paid.`,
          },
          { status: 422 },
        );
      }
      throw new Error(`expected 402 from merchant, got ${probe.status}`);
    }
    const option = ((JSON.parse(atob(probeHeader)) as Invoice).accepts as never as PaymentRequirements[]).find((a) => a.network === HEDERA_NETWORK);
    if (!option?.amount) throw new Error("merchant returned no payment options");
    // ENS first: a dishonest invoice is refused for what it is, whatever the budget.
    const guard = body.kind === "ondc" ? assertVerifiedPayee : assertFairInvoice;
    await guard(option);
    // And the pasted page must live on the merchant's registered ENS endpoint.
    if (body.kind === "url") await assertUrlMerchantOrigin(url, option);
    await assertBudgetAllows(BigInt(option.amount));

    // The memo rides in the signed transfer: HashScan shows an agent paid this.
    const { buy } = agent(guard, `Sangam AI agent | x402 | ${url.host} | ${what}`);
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
      hashscan: explorerUrl(tx),
      explorer: explorerUrl(tx),
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
