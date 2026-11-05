import { AccountCreateTransaction, Hbar, TokenAssociateTransaction } from "@hiero-ledger/sdk";
import { operatorClient, usdcTokenId } from "./client.ts";

/*
 * Per-merchant deposit accounts. Each merchant gets its own Hedera account,
 * published as sangam.payTo in its ENS name, so USDC that lands there can only
 * be for that merchant (a shared treasury lets any merchant's notice claim any
 * payment). The account's key is the operator's key: Sangam can refund from it
 * and never has to store a new private key per merchant.
 */

export type DepositAccount = { accountId: string; createTx: string; associateTx: string };

export async function createDepositAccount(memo: string): Promise<DepositAccount> {
  const client = operatorClient();
  const operatorKey = client.operatorPublicKey;
  if (!operatorKey) throw new Error("operator client has no public key");

  const create = await new AccountCreateTransaction()
    .setKey(operatorKey)
    .setInitialBalance(new Hbar(0))
    .setAccountMemo(memo.slice(0, 100))
    .execute(client);
  const accountId = (await create.getReceipt(client)).accountId?.toString();
  if (!accountId) throw new Error("AccountCreate returned no account id");

  // HTS: an account must be associated with USDC before it can receive it.
  // Signed by the operator, which is the new account's key.
  const associate = await new TokenAssociateTransaction().setAccountId(accountId).setTokenIds([usdcTokenId()]).execute(client);
  await associate.getReceipt(client);

  return { accountId, createTx: create.transactionId.toString(), associateTx: associate.transactionId.toString() };
}
