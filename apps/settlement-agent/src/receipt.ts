import { Client, PrivateKey, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { env } from "@sangam/shared";

let client: Client | null = null;

/**
 * Write a receipt to the HCS topic and return its sequence number.
 * Returns null (and logs) when HCS_TOPIC_ID isn't set yet.
 */
export async function writeReceipt(message: Record<string, unknown>): Promise<number | null> {
  const topicId = process.env.HCS_TOPIC_ID;
  if (!topicId) {
    console.warn("[receipt] HCS_TOPIC_ID not set; skipping HCS receipt");
    return null;
  }
  client ??= Client.forTestnet().setOperator(
    env("OPERATOR_ACCOUNT_ID"),
    PrivateKey.fromStringECDSA(env("OPERATOR_PRIVATE_KEY")),
  );
  const submitted = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(JSON.stringify(message))
    .execute(client);
  const receipt = await submitted.getReceipt(client);
  return receipt.topicSequenceNumber?.toNumber() ?? null;
}
