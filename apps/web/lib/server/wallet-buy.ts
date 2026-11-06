import "server-only";
import { after } from "next/server";
import type { Hex } from "viem";
import { UntrustedPayeeError, assertFairInvoice, parentName, readProductInfo, resolveMerchant } from "@sangam/ens";
import { inrPerUsd, paiseToUsdcAtomic } from "@sangam/shared";
import { buyerKey } from "./evm-keys";
import { DuplicateSettlementError, acceptNotice, runPipeline } from "./pipeline";
import { WalletPayError, agentPayFromWallet, sepoliaTxUrl } from "./sepolia";
import type { SignedIn } from "./session";

/*
 * The agent buys by ENS name from the buyer's own MetaMask (Sepolia USDC).
 * No merchant website is involved: who to pay and how much both come from
 * ENS. The name's standard address record is the payee (the same address a
 * wallet resolves for the name) and its price record is the amount. The
 * buyer's allowance in its wallet is the hard limit; Sangam can't exceed it.
 */

const SEPOLIA_NETWORK = "eip155:11155111";

/** bakery.sangam.eth for a product name (truffle.bakery.sangam.eth); the name itself for a shop. */
function shopOf(ensName: string): string {
  const suffix = `.${parentName()}`;
  const local = ensName.slice(0, -suffix.length);
  return local.includes(".") ? `${local.slice(local.indexOf(".") + 1)}${suffix}` : ensName;
}

export async function walletBuy(me: SignedIn, body: { ensName?: string; url?: string }): Promise<Response> {
  const owner = me.identity.evmWallet?.address as Hex | undefined;
  if (!owner) return Response.json({ error: "Connect your MetaMask on the buyer desk first." }, { status: 400 });
  const ensName = (body.ensName ?? "").trim().toLowerCase();
  if (!ensName || !ensName.endsWith(`.${parentName()}`)) {
    return Response.json({ error: "Wallet payments go to a Sangam merchant or product by its ENS name." }, { status: 400 });
  }

  let record;
  try {
    record = await resolveMerchant(ensName);
  } catch (err) {
    return Response.json({ error: `${ensName}: ${(err as Error).message.split("\n")[0]}` }, { status: 404 });
  }
  if (!record.evmPayTo) return Response.json({ error: `${ensName} has no ENS address record for wallet payments yet.` }, { status: 409 });

  const amount = paiseToUsdcAtomic(record.priceInrPaise, await inrPerUsd());
  const shop = shopOf(ensName);
  try {
    // The same verified-merchant check as every other rail: verified, not suspended,
    // its shop verified, paying the shop's own address, at the ENS price.
    const payee = await assertFairInvoice({ payTo: record.evmPayTo, network: SEPOLIA_NETWORK, amount: amount.toString(), extra: { ensName } });

    const { hash } = await agentPayFromWallet({ agentKey: buyerKey(me.identity.nullifier), owner, to: record.evmPayTo as Hex, amount });

    const product = shop !== ensName ? { ensName, title: (await readProductInfo(ensName).catch(() => null))?.title || ensName } : undefined;
    let settlement = null;
    try {
      settlement = await acceptNotice({
        merchant: shop,
        hederaTxId: hash,
        rail: "sepolia",
        payer: owner,
        usdcAmount: amount.toString(),
        quotedInrPaise: record.priceInrPaise,
        ...(product ? { product } : {}),
      });
      const s = settlement;
      after(() => runPipeline(s));
    } catch (err) {
      if (!(err instanceof DuplicateSettlementError)) throw err;
    }
    return Response.json({
      ensName,
      rail: "sepolia",
      priceAtomic: amount.toString(),
      hederaTxId: hash,
      hashscan: sepoliaTxUrl(hash),
      explorer: sepoliaTxUrl(hash),
      payTo: payee.payTo,
      from: owner,
      settlement,
    });
  } catch (err) {
    if (err instanceof UntrustedPayeeError) return Response.json({ refused: true, reason: err.reason, error: err.message }, { status: 403 });
    if (err instanceof WalletPayError) return Response.json({ error: err.message }, { status: 402 });
    return Response.json({ error: (err as Error).message.split("\n")[0] }, { status: 502 });
  }
}
