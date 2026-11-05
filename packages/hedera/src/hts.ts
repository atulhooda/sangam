import { Client, PrivateKey, TokenAssociateTransaction } from "@hiero-ledger/sdk";
import { mirrorNodeUrl, usdcTokenId } from "./client.ts";

/** USDC balance of an account in atomic units, read from the Mirror Node (no key needed). */
export async function usdcBalance(accountId: string): Promise<bigint> {
  const url = `${mirrorNodeUrl()}/api/v1/accounts/${accountId}/tokens?token.id=${usdcTokenId()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`mirror node returned ${res.status}`);
  const body = (await res.json()) as { tokens: { balance: number }[] };
  return BigInt(body.tokens[0]?.balance ?? 0);
}

/**
 * Associate an account with the USDC token so it can receive it (an HTS
 * requirement). Used by scripts/setup-hedera.ts for the treasury.
 */
export async function associateUsdc(accountId: string, privateKey: string): Promise<string> {
  const key = PrivateKey.fromStringECDSA(privateKey);
  const client = Client.forTestnet().setOperator(accountId, key);
  try {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([usdcTokenId()])
      .freezeWith(client)
      .sign(key);
    const receipt = await (await tx.execute(client)).getReceipt(client);
    return receipt.status.toString();
  } finally {
    client.close();
  }
}
