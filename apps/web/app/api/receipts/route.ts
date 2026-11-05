import { verifyReceiptChain } from "@sangam/hedera";
import { listSettlements } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Independent verification of the HCS receipt chain: replayed from the Mirror
 * Node, not from anything Sangam has on disk. `lagging` is true when a
 * settled payment's receipt hasn't shown up on the mirror node yet (it lags
 * consensus by a few seconds) — that's not a broken chain.
 */
export async function GET() {
  const topicId = process.env.HCS_TOPIC_ID;
  if (!topicId) return Response.json({ enabled: false }, { headers: { "cache-control": "no-store" } });
  const newestReceipt = listSettlements().find((s) => s.hcsSequence !== null)?.hcsSequence ?? null;
  const verification = await verifyReceiptChain(topicId, { headSeq: newestReceipt });
  return Response.json({ enabled: true, ...verification }, { headers: { "cache-control": "no-store" } });
}
