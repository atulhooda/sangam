// One-off: create the HCS topic Sangam writes receipts to. Prints HCS_TOPIC_ID.
//   npm run create-topic
import { createTopic, hashscanTopicUrl, operatorClient } from "@sangam/hedera";

const topicId = await createTopic();
console.log(`HCS_TOPIC_ID=${topicId}`);
console.log(hashscanTopicUrl(topicId));
operatorClient().close();
