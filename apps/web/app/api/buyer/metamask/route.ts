import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { buyerAddress } from "@/lib/server/evm-keys";
import { requireBuyer } from "@/lib/server/buyer";
import { linkMessage } from "@/lib/wallet-link";
import { setBuyerEvmWallet } from "@/lib/server/identity";
import { SEPOLIA_CHAIN_ID, sepoliaAddressUrl, sepoliaUsdc, usdcAllowance, usdcBalance } from "@/lib/server/sepolia";

export const dynamic = "force-dynamic";

/*
 * The buyer's own MetaMask, for agent payments on Sepolia.
 *   GET     the linked wallet, the agent's address (the spender to approve),
 *           the wallet's USDC balance and how much the agent may still spend
 *   POST    { address, message, signature } link a wallet, proven by a signed message
 *   DELETE  unlink (the allowance itself is revoked in the wallet)
 */

async function view(buyerId: string, linked: { address: string; linkedAt: string } | undefined) {
  const agent = buyerAddress(buyerId);
  const base = { agent, chainId: SEPOLIA_CHAIN_ID, usdc: sepoliaUsdc() };
  if (!linked) return { ...base, address: null };
  const owner = linked.address as Hex;
  const [balance, allowance] = await Promise.all([usdcBalance(owner).catch(() => null), usdcAllowance(owner, agent).catch(() => null)]);
  return {
    ...base,
    address: linked.address,
    linkedAt: linked.linkedAt,
    balanceAtomic: balance === null ? null : balance.toString(),
    allowanceAtomic: allowance === null ? null : allowance.toString(),
    explorer: sepoliaAddressUrl(linked.address),
  };
}

export async function GET() {
  const me = await requireBuyer();
  if (!me) return Response.json({ error: "Sign in as a buyer first." }, { status: 401 });
  return Response.json(await view(me.identity.nullifier, me.identity.evmWallet), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const me = await requireBuyer();
  if (!me) return Response.json({ error: "Sign in as a buyer first." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { address?: string; issuedAt?: string; signature?: string };
  if (!body.address || !isAddress(body.address) || !body.signature || !body.issuedAt) {
    return Response.json({ error: "Send the wallet address, the time and the signature." }, { status: 400 });
  }
  const age = Date.now() - Date.parse(body.issuedAt);
  if (!(age >= -60_000 && age < 10 * 60_000)) return Response.json({ error: "That signature is too old. Try again." }, { status: 400 });
  const address = getAddress(body.address);
  const message = linkMessage(buyerAddress(me.identity.nullifier), address, body.issuedAt);
  const ok = await verifyMessage({ address, message, signature: body.signature as Hex }).catch(() => false);
  if (!ok) return Response.json({ error: "The signature doesn't match that wallet." }, { status: 400 });
  const identity = await setBuyerEvmWallet(me.identity.nullifier, { address, linkedAt: new Date().toISOString() });
  return Response.json(await view(identity.nullifier, identity.evmWallet));
}

export async function DELETE() {
  const me = await requireBuyer();
  if (!me) return Response.json({ error: "Sign in as a buyer first." }, { status: 401 });
  const identity = await setBuyerEvmWallet(me.identity.nullifier, undefined);
  return Response.json(await view(identity.nullifier, identity.evmWallet));
}
