import { PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { env } from "@sangam/shared";
import { hashReceiptMessage, readChainHead, saveChainHead, type ChainHead } from "./chain.ts";
import { operatorClient } from "./client.ts";

/**
 * Write a settlement receipt to the HCS topic and return its sequence number
 * and chain hash. Hedera Consensus Service gives every receipt a consensus
 * timestamp and order that nobody (including Sangam) can rewrite later.
 *
 * Receipts are hash-chained: each carries `prev`, the sequence number and
 * hash of the receipt before it, so anyone replaying the topic from the
 * Mirror Node can verify none was dropped or reordered (see chain.ts).
 */
export async function writeReceipt(topicId: string, message: Record<string, unknown>): Promise<{ seq: number; hash: string; head: ChainHead }> {
  const client = operatorClient();
  const head = await readChainHead(topicId);
  const payload = {
    v: 1,
    kind: "sangam.settlement",
    // kept ahead of ...message so a caller can't clobber the chain
    prev: head ? { seq: head.seq, hash: head.hash } : null,
    ...message,
  };
  const submitted = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(JSON.stringify(payload))
    .execute(client);
  const receipt = await submitted.getReceipt(client);
  const seq = receipt.topicSequenceNumber?.toNumber();
  if (seq === undefined) throw new Error("HCS receipt had no sequence number");
  const hash = hashReceiptMessage({ ...payload, seq });
  const tip = { topicId, seq, hash };
  await saveChainHead(tip);
  return { seq, hash, head: tip };
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
