// One-off: create the HCS topic Sangam writes receipts to. Prints HCS_TOPIC_ID.
import { Client, PrivateKey, TopicCreateTransaction } from "@hiero-ledger/sdk";
import { env, hashscanTopicUrl } from "@sangam/shared";

const key = PrivateKey.fromStringECDSA(env("OPERATOR_PRIVATE_KEY"));
const client = Client.forTestnet().setOperator(env("OPERATOR_ACCOUNT_ID"), key);

const tx = await new TopicCreateTransaction()
  .setTopicMemo("Sangam settlement receipts")
  .setSubmitKey(key.publicKey) // only the operator can write receipts
  .execute(client);
const { topicId } = await tx.getReceipt(client);
if (!topicId) throw new Error("no topic ID in receipt");

console.log(`HCS_TOPIC_ID=${topicId.toString()}`);
console.log(hashscanTopicUrl(topicId.toString()));
client.close();
