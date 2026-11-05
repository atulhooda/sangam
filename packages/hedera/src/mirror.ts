import { mirrorNodeUrl, usdcTokenId } from "./client.ts";
import { toMirrorTxId } from "./hashscan.ts";

type MirrorTx = {
  result: string;
  token_transfers?: { token_id: string; account: string; amount: number }[];
};

export type ConfirmedPayment = { credited: bigint; payer: string | null };

/**
 * Check on the Hedera Mirror Node that the transaction succeeded and credited
 * `payTo` with at least `claimed` USDC units. Sangam never pays a merchant out
 * on the merchant's word alone.
 *
 * The Mirror Node lags consensus by a few seconds, so this polls (~15 s max).
 */
export async function confirmPayment(hederaTxId: string, payTo: string, claimed: bigint): Promise<ConfirmedPayment> {
  const token = usdcTokenId();
  const url = `${mirrorNodeUrl()}/api/v1/transactions/${toMirrorTxId(hederaTxId)}`;

  let tx: MirrorTx | undefined;
  for (let attempt = 0; attempt < 10 && !tx; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) tx = ((await res.json()) as { transactions: MirrorTx[] }).transactions[0];
    else if (res.status !== 404) throw new Error(`mirror node returned ${res.status}`);
    if (!tx) await new Promise((r) => setTimeout(r, 1_500));
  }
  if (!tx) throw new Error(`transaction ${hederaTxId} not found on mirror node`);
  if (tx.result !== "SUCCESS") throw new Error(`transaction result was ${tx.result}`);

  const usdc = (tx.token_transfers ?? []).filter((t) => t.token_id === token);
  const credited = usdc.filter((t) => t.account === payTo && t.amount > 0).reduce((sum, t) => sum + BigInt(t.amount), 0n);
  if (credited < claimed) {
    throw new Error(`treasury credited ${credited} USDC units, notice claimed ${claimed}`);
  }
  const payer = usdc.find((t) => t.amount < 0)?.account ?? null;
  return { credited, payer };
}
