import "server-only";
import { after } from "next/server";
import type { Hex } from "viem";
import { UntrustedPayeeError, assertFairInvoice, parentName, readProductInfo, resolveMerchant } from "@sangam/ens";
import { HEDERA_NETWORK } from "@sangam/hedera";
import { getBoloInvoice, markBoloPaid } from "./bolo";
import { BadBuyUrlError, assertUrlMerchantOrigin, parseAgentUrl } from "./buy-url";
import { buyerKey } from "./evm-keys";
import { merchantEnsName } from "./merchant";
import { DuplicateSettlementError, acceptNotice, runPipeline } from "./pipeline";
import { probeInvoice } from "./rails";
import { WalletPayError, agentPayFromWallet, sepoliaTxUrl } from "./sepolia";
import type { SignedIn } from "./session";

/*
 * The agent buys from the buyer's own MetaMask (Sepolia USDC), by ENS name or
 * at a pay link (a bargained or spoken invoice). It does exactly what the
 * Hedera agent does before it signs: fetch the merchant's checkout, read the
 * 402 invoice, and compare it with ENS — who it pays (sangam.payTo) and how
 * much (the ENS price, plus the merchant's published haggle margin). A hacked
 * checkout that overcharges or redirects is refused here too; only an honest
 * invoice gets paid, to the name's standard address record (the same address
 * a wallet resolves for the name), with the agent's key spending the buyer's
 * allowance (transferFrom). The buyer's allowance is the hard limit.
 */

/** bakery.sangam.eth for a product name (truffle.bakery.sangam.eth); the name itself for a shop. */
function shopOf(ensName: string): string {
  const suffix = `.${parentName()}`;
  const local = ensName.slice(0, -suffix.length);
  return local.includes(".") ? `${local.slice(local.indexOf(".") + 1)}${suffix}` : ensName;
}

export async function walletBuy(me: SignedIn, body: { ensName?: string; url?: string }, selfOrigin: string): Promise<Response> {
  const owner = me.identity.evmWallet?.address as Hex | undefined;
  if (!owner) return Response.json({ error: "Connect your MetaMask on the buyer desk first." }, { status: 400 });
  const suffix = `.${parentName()}`;

  // Where the invoice comes from: the merchant's registered checkout (by ENS
  // name), or a buyer-supplied pay link (vetted like any pasted URL).
  let url: URL;
  let wanted: string | null = null;
  if ((body.url ?? "").trim()) {
    try {
      url = await parseAgentUrl(body.url!.trim(), selfOrigin);
    } catch (err) {
      if (err instanceof BadBuyUrlError) return Response.json({ error: err.message }, { status: 422 });
      throw err;
    }
  } else {
    wanted = (body.ensName ?? "").trim().toLowerCase();
    if (!wanted || !wanted.endsWith(suffix)) {
      return Response.json({ error: "Wallet payments go to a Sangam merchant or product by its ENS name." }, { status: 400 });
    }
    try {
      url = new URL((await resolveMerchant(wanted)).endpoint);
      if (wanted === merchantEnsName()) {
        url.searchParams.set("from", "CSMT");
        url.searchParams.set("to", "PUNE");
      }
    } catch (err) {
      return Response.json({ error: `${wanted}: ${(err as Error).message.split("\n")[0]}` }, { status: 404 });
    }
  }

  try {
    // 1. Read the shop's own bill. The merchant prices in Hedera USDC; the
    //    agent pays the same USDC amount from the buyer's wallet on Sepolia.
    const option = (await probeInvoice(url)).find((a) => a.network === HEDERA_NETWORK);
    if (!option?.amount) throw new Error(`${url.host} offered no USDC invoice the agent can pay`);
    const ensName = typeof option.extra?.ensName === "string" ? option.extra.ensName.trim().toLowerCase() : "";
    if (wanted && ensName !== wanted) {
      throw new UntrustedPayeeError(`Refused: ${wanted}'s checkout billed for ${ensName || "no merchant"}, not for itself.`, "payto-mismatch");
    }

    // 2. ENS first: the bill must pay the merchant's own account, at its
    //    published price (plus its haggle margin). A hacked checkout fails here.
    const payee = await assertFairInvoice(option);
    if (!wanted) await assertUrlMerchantOrigin(url, option);
    const record = await resolveMerchant(ensName);
    if (!record.evmPayTo) return Response.json({ error: `${ensName} has no ENS address record for wallet payments yet.` }, { status: 409 });
    const amount = BigInt(option.amount);

    // 3. The agent signs: transferFrom under the buyer's allowance.
    const { hash, agent } = await agentPayFromWallet({ agentKey: buyerKey(me.identity.nullifier), owner, to: record.evmPayTo as Hex, amount });

    // A spoken or bargained invoice carries its own rupee amount; a shop bill is the ENS price.
    const boloId = typeof option.extra?.boloInvoice === "string" ? option.extra.boloInvoice : null;
    const bolo = boloId ? getBoloInvoice(boloId) : undefined;
    const shop = shopOf(ensName);
    const product = shop !== ensName ? { ensName, title: (await readProductInfo(ensName).catch(() => null))?.title || ensName } : undefined;
    let settlement = null;
    try {
      settlement = await acceptNotice({
        merchant: shop,
        hederaTxId: hash,
        rail: "sepolia",
        payer: owner,
        agent,
        usdcAmount: amount.toString(),
        quotedInrPaise: bolo?.amountPaise ?? record.priceInrPaise,
        ...(product ? { product } : {}),
      });
      const s = settlement;
      after(() => runPipeline(s));
    } catch (err) {
      if (!(err instanceof DuplicateSettlementError)) throw err;
    }
    if (bolo) await markBoloPaid(bolo.id, hash);
    return Response.json({
      ensName,
      url: wanted ? undefined : url.toString(),
      rail: "sepolia",
      priceAtomic: amount.toString(),
      hederaTxId: hash,
      hashscan: sepoliaTxUrl(hash),
      explorer: sepoliaTxUrl(hash),
      payTo: record.evmPayTo,
      hederaPayee: payee.payTo,
      from: owner,
      agent,
      settlement,
    });
  } catch (err) {
    if (err instanceof UntrustedPayeeError) return Response.json({ refused: true, reason: err.reason, error: err.message }, { status: 403 });
    if (err instanceof WalletPayError) return Response.json({ error: err.message }, { status: 402 });
    return Response.json({ error: (err as Error).message.split("\n")[0] }, { status: 502 });
  }
}
