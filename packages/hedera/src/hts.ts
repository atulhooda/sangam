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

/** Plain USDC transfer signed by `fromKey` (an ECDSA hex key). Returns the transaction id. */
export async function transferUsdc(fromAccount: string, fromKey: string, toAccount: string, atomic: bigint): Promise<string> {
  const { TransferTransaction } = await import("@hiero-ledger/sdk");
  const client = Client.forTestnet().setOperator(fromAccount, PrivateKey.fromStringECDSA(fromKey));
  try {
    const tx = await new TransferTransaction()
      .addTokenTransfer(usdcTokenId(), fromAccount, -atomic)
      .addTokenTransfer(usdcTokenId(), toAccount, atomic)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    if (receipt.status.toString() !== "SUCCESS") throw new Error(`transfer ${receipt.status.toString()}`);
    return tx.transactionId.toString();
  } finally {
    client.close();
  }
}
