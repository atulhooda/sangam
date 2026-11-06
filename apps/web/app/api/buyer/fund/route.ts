import { env, hasEnv } from "@sangam/shared";
import { hashscanTxUrl, transferUsdc } from "@sangam/hedera";
import { explorerTxUrl, sendUsdtFromRelayer } from "@sangam/whitechain";
import { buyerWhitechainAddress, faucetMaxAtomic, faucetPerClickAtomic, requireBuyer } from "@/lib/server/buyer";
import { setBuyerWallet } from "@/lib/server/identity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Demo faucet: sends test USDC from Sangam's demo account (CUSTOMER_*) to the
 * buyer's agent wallet, up to BUYER_FAUCET_MAX per buyer. Testnet only.
 * { rail: "whitechain" } sends test USDT from Sangam's relayer to the buyer's
 * Whitechain agent address instead (same per-buyer allowance).
 */
export async function POST(req: Request) {
  const me = await requireBuyer();
  if (!me) return Response.json({ error: "Sign in as a buyer first." }, { status: 401 });
  const wallet = me.identity.wallet;
  if (!wallet) return Response.json({ error: "Connect your agent wallet first." }, { status: 400 });
  if (!hasEnv("CUSTOMER_ACCOUNT_ID", "CUSTOMER_PRIVATE_KEY")) return Response.json({ error: "The demo faucet isn't configured (CUSTOMER_* in .env)." }, { status: 503 });

  const left = faucetMaxAtomic() - BigInt(wallet.fundedAtomic);
  if (left <= 0n) return Response.json({ error: "You've had all the free test USDC. Send more to your wallet from any Hedera account." }, { status: 429 });
  const amount = faucetPerClickAtomic() < left ? faucetPerClickAtomic() : left;

  const { rail } = (await req.json().catch(() => ({}))) as { rail?: string };
  if (rail === "whitechain") {
    const to = buyerWhitechainAddress(me.identity.nullifier);
    if (!to) return Response.json({ error: "The Whitechain rail isn't configured (WHITECHAIN_RELAYER_PRIVATE_KEY)." }, { status: 503 });
    try {
      const tx = await sendUsdtFromRelayer(to, amount);
      await setBuyerWallet(me.identity.nullifier, { ...wallet, fundedAtomic: (BigInt(wallet.fundedAtomic) + amount).toString() });
      return Response.json({ ok: true, rail, amountAtomic: amount.toString(), txHash: tx, hashscan: explorerTxUrl(tx), explorer: explorerTxUrl(tx) });
    } catch (err) {
      return Response.json({ error: `Faucet transfer failed: ${(err as Error).message.split("\n")[0]}` }, { status: 502 });
    }
  }

  try {
    const tx = await transferUsdc(env("CUSTOMER_ACCOUNT_ID"), env("CUSTOMER_PRIVATE_KEY"), wallet.accountId, amount);
    await setBuyerWallet(me.identity.nullifier, { ...wallet, fundedAtomic: (BigInt(wallet.fundedAtomic) + amount).toString() });
    return Response.json({ ok: true, amountAtomic: amount.toString(), hederaTxId: tx, hashscan: hashscanTxUrl(tx) });
  } catch (err) {
    return Response.json({ error: `Faucet transfer failed: ${(err as Error).message.split("\n")[0]}` }, { status: 502 });
  }
}
