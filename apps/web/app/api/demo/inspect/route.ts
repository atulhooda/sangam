import { PRICE_TOLERANCE_BPS, UntrustedPayeeError, assertFairInvoice, resolveMerchant } from "@sangam/ens";
import { formatUsdc, inrPerUsd, paiseToUsdcAtomic, usdcAtomicToPaise } from "@sangam/shared";
import { SHOPS, parseAttack, parseShop, type Check, type Inspection } from "@/lib/demo-shop";
import { bakeryEnsName, merchantEnsName } from "@/lib/server/merchant";
import type { Invoice } from "@/lib/types";

export const dynamic = "force-dynamic";

/*
 * The demo's "what is the agent checking?" view. For the railway shop (honest)
 * or the bakery (backend hacked), it reads the shop's 402 invoice exactly as the buyer agent
 * does, reads the merchant's ENS record, and runs the same pre-payment check
 * the agent runs (assertFairInvoice). It reports each comparison side by side.
 * Nothing is signed and no money moves, so it needs no sign-in.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const shop = parseShop(params.get("shop"));
  const variant = SHOPS[shop].variant;
  const attack = variant === "hacked" ? parseAttack(params.get("attack")) : null;
  const origin = new URL(req.url).origin;
  const name = shop === "bakery" ? bakeryEnsName() : merchantEnsName();

  try {
    let invoiceUrl: URL;
    if (shop === "bakery") {
      // The bakery's hacked backend: same ENS name, rewritten invoice.
      invoiceUrl = new URL(`${origin}/demo/shop/bakery/book`);
      invoiceUrl.searchParams.set("attack", attack!);
    } else {
      // The railway shop is the real merchant, found the way the agent finds it: by ENS name.
      invoiceUrl = new URL((await resolveMerchant(name)).endpoint);
      invoiceUrl.searchParams.set("from", "CSMT");
      invoiceUrl.searchParams.set("to", "PUNE");
    }

    const probe = await fetch(invoiceUrl, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const header = probe.headers.get("PAYMENT-REQUIRED");
    if (probe.status !== 402 || !header) {
      const why = ((await probe.json().catch(() => null)) as { error?: string } | null)?.error;
      throw new Error(why ?? `expected a 402 invoice from the shop, got ${probe.status}`);
    }
    const option = (JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Invoice).accepts[0];
    if (!option) throw new Error("the shop's invoice has no payment options");

    const extra = option.extra as Record<string, unknown> | undefined;
    const claimed = typeof extra?.ensName === "string" ? extra.ensName.trim().toLowerCase() : "";
    const record = await resolveMerchant(claimed || name);
    const rate = await inrPerUsd();
    const ensAtomic = paiseToUsdcAtomic(record.priceInrPaise, rate);
    const billed = BigInt(option.amount);
    const ceiling = (ensAtomic * BigInt(10_000 + PRICE_TOLERANCE_BPS)) / 10_000n;
    const billedInr = usdcAtomicToPaise(billed, rate) / 100;

    const checks: Check[] = [
      { label: "Merchant is verified", ok: record.status === "verified", ens: record.status ?? "not set", invoice: claimed || "no name" },
      { label: "Pays the account in ENS", ok: option.payTo === record.hederaPayTo, ens: record.hederaPayTo, invoice: option.payTo },
      { label: "Same network", ok: option.network === record.network, ens: record.network, invoice: option.network },
      {
        label: "Price matches ENS",
        ok: billed <= ceiling,
        ens: `₹${(record.priceInrPaise / 100).toFixed(2)} · ${formatUsdc(ensAtomic)} USDC`,
        invoice: `₹${billedInr.toFixed(2)} · ${formatUsdc(billed)} USDC`,
      },
    ];

    // The verdict comes from the agent's own guard, not from the list above.
    let verdict: Inspection["verdict"] = "pay";
    let reason: string | null = null;
    try {
      await assertFairInvoice(option);
    } catch (err) {
      if (!(err instanceof UntrustedPayeeError)) throw err;
      verdict = "refuse";
      reason = err.message;
    }

    const body: Inspection = {
      shop,
      variant,
      attack,
      invoiceUrl: invoiceUrl.toString(),
      ens: {
        name: record.ensName,
        priceInr: record.priceInrPaise / 100,
        priceUsdc: formatUsdc(ensAtomic),
        payTo: record.hederaPayTo,
        network: record.network,
        status: record.status ?? "not set",
      },
      invoice: { amountUsdc: formatUsdc(billed), amountInr: billedInr, payTo: option.payTo, network: option.network, ensName: claimed },
      checks,
      verdict,
      reason,
    };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: (err as Error).message.split("\n")[0] }, { status: 502 });
  }
}
