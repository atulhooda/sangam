import { PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { env } from "@sangam/shared";
import { operatorClient } from "./client.ts";

/**
 * Write a settlement receipt to the HCS topic and return its sequence number.
 * Hedera Consensus Service gives every receipt a consensus timestamp and
 * order that nobody (including Sangam) can rewrite later.
 */
export async function writeReceipt(topicId: string, message: Record<string, unknown>): Promise<number> {
  const client = operatorClient();
  const submitted = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(JSON.stringify({ v: 1, kind: "sangam.settlement", ...message }))
    .execute(client);
  const receipt = await submitted.getReceipt(client);
  const seq = receipt.topicSequenceNumber?.toNumber();
  if (seq === undefined) throw new Error("HCS receipt had no sequence number");
  return seq;
}

/** One-off setup: a topic only the operator key can write to. Returns the topic id. */
export async function createTopic(memo = "Sangam settlement receipts"): Promise<string> {
  const client = operatorClient();
  const key = PrivateKey.fromStringECDSA(env("OPERATOR_PRIVATE_KEY"));
  const tx = await new TopicCreateTransaction().setTopicMemo(memo).setSubmitKey(key.publicKey).execute(client);
  const { topicId } = await tx.getReceipt(client);
  if (!topicId) throw new Error("no topic ID in receipt");
  return topicId.toString();
}
