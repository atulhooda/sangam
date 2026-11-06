import { createDepositAccount, usdcBalance } from "@sangam/hedera";
import { buyerBudgetAtomic, faucetMaxAtomic, requireBuyer, spentByWallet } from "@/lib/server/buyer";
import { setBuyerWallet } from "@/lib/server/identity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function view(wallet: { accountId: string; createdAt: string; fundedAtomic: string } | undefined) {
  if (!wallet) return { wallet: null };
  const balance = await usdcBalance(wallet.accountId).catch(() => null);
  const spent = spentByWallet(wallet.accountId);
  const limit = buyerBudgetAtomic();
  const faucetLeft = faucetMaxAtomic() - BigInt(wallet.fundedAtomic);
  return {
    wallet,
    balanceAtomic: balance === null ? null : balance.toString(),
    spentAtomic: spent.toString(),
    limitAtomic: limit.toString(),
    remainingAtomic: (limit > spent ? limit - spent : 0n).toString(),
    faucetLeftAtomic: (faucetLeft > 0n ? faucetLeft : 0n).toString(),
  };
}

/** The signed-in buyer's agent wallet: balance, spend, budget, faucet allowance. */
export async function GET() {
  const me = await requireBuyer();
  if (!me) return Response.json({ error: "Sign in as a buyer first." }, { status: 401 });
  return Response.json(await view(me.identity.wallet), { headers: { "cache-control": "no-store" } });
}

/** Connect (create) the buyer's agent wallet: its own Hedera account, USDC-enabled. */
export async function POST() {
  const me = await requireBuyer();
  if (!me) return Response.json({ error: "Sign in as a buyer first." }, { status: 401 });
  if (me.identity.wallet) return Response.json(await view(me.identity.wallet));
  try {
    const acct = await createDepositAccount("Sangam buyer agent wallet");
    const identity = await setBuyerWallet(me.identity.nullifier, { accountId: acct.accountId, createdAt: new Date().toISOString(), fundedAtomic: "0" });
    return Response.json(await view(identity.wallet));
  } catch (err) {
    return Response.json({ error: `Could not create the wallet: ${(err as Error).message.split("\n")[0]}` }, { status: 502 });
  }
}
