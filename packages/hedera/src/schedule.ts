import { Client, PrivateKey, ScheduleCreateTransaction, ScheduleSignTransaction, TransferTransaction } from "@hiero-ledger/sdk";
import { env, hasEnv } from "@sangam/shared";
import { operatorAccountId, operatorClient, treasuryAccountId, usdcTokenId } from "./client.ts";

/*
 * Scheduled refunds: when Sangam holds a payment, the USDC sits in the
 * treasury. Instead of moving it back on Sangam's word later, it schedules
 * the refund transaction on Hedera. A schedule is created once and executes
 * by itself once the required signatures exist — and because it is created
 * with no admin key, nobody (including Sangam) can change or cancel it after
 * the fact.
 */

export type ScheduledRefund = {
  scheduleId: string;
  transactionId: string;
  amountAtomic: string;
  payer: string;
};

/**
 * Schedule a USDC transfer from the account that received the payment (the
 * merchant's deposit account, or the shared treasury for older merchants)
 * back to the payer. Deposit accounts are keyed to the operator, so their
 * refunds execute at once; a separate treasury countersigns if we hold its key.
 */
export async function createScheduledRefund(payerAccount: string, usdcAmountAtomic: string, memo: string, fromAccount?: string): Promise<ScheduledRefund> {
  const client = operatorClient();
  const treasury = fromAccount ?? treasuryAccountId();
  const token = usdcTokenId();

  const transfer = new TransferTransaction()
    .addTokenTransfer(token, treasury, -BigInt(usdcAmountAtomic))
    .addTokenTransfer(token, payerAccount, BigInt(usdcAmountAtomic));

  const executed = await new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    // no admin key: immutable once created
    .setTransactionMemo(memo.slice(0, 100))
    .execute(client);
  const receipt = await executed.getReceipt(client);
  const scheduleId = receipt.scheduleId?.toString();
  if (!scheduleId) throw new Error("ScheduleCreate had no schedule id");

  // If the treasury is a separate account and we hold its key, countersign so
  // the refund executes right away instead of waiting for a human.
  if (treasury === treasuryAccountId() && treasury !== operatorAccountId() && hasEnv("TREASURY_PRIVATE_KEY")) {
    const key = PrivateKey.fromStringECDSA(env("TREASURY_PRIVATE_KEY"));
    const treasuryClient = Client.forTestnet().setOperator(treasury, key);
    try {
      const sign = await new ScheduleSignTransaction().setScheduleId(scheduleId).execute(treasuryClient);
      await sign.getReceipt(treasuryClient);
    } finally {
      treasuryClient.close();
    }
  }

  return { scheduleId, transactionId: executed.transactionId.toString(), amountAtomic: usdcAmountAtomic, payer: payerAccount };
}
