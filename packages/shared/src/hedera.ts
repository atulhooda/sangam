/**
 * The SDK formats transaction IDs as "0.0.123@1700000000.123456789".
 * The Mirror Node REST API wants "0.0.123-1700000000-123456789".
 */
export function toMirrorTxId(txId: string): string {
  if (!txId.includes("@")) return txId;
  const [account, timestamp] = txId.split("@") as [string, string];
  return `${account}-${timestamp.replace(".", "-")}`;
}

export function hashscanTxUrl(txId: string, network = "testnet"): string {
  return `https://hashscan.io/${network}/transaction/${encodeURIComponent(txId)}`;
}

export function hashscanTopicUrl(topicId: string, network = "testnet"): string {
  return `https://hashscan.io/${network}/topic/${topicId}`;
}
