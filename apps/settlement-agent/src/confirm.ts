import { HEDERA_TESTNET_USDC } from "@x402/hedera";
import { envOr, flag, toMirrorTxId } from "@sangam/shared";

type MirrorTx = {
  result: string;
  token_transfers?: { token_id: string; account: string; amount: number }[];
};

export type ConfirmedPayment = { credited: bigint; payer: string | null };

/**
 * Check on the Mirror Node that the transaction succeeded and credited the
 * treasury with USDC. Doesn't trust merchant-api's word for it.
 *
 * SKIP_CHAIN_VERIFY=true trusts the notice instead (dev only, for simulate-settlement).
 */
export async function confirmPayment(hederaTxId: string, payTo: string, claimed: bigint): Promise<ConfirmedPayment> {
  if (flag("SKIP_CHAIN_VERIFY")) return { credited: claimed, payer: null };

  const mirror = envOr("MIRROR_NODE_URL", "https://testnet.mirrornode.hedera.com");
  const token = envOr("HEDERA_USDC_TOKEN_ID", HEDERA_TESTNET_USDC);
  const url = `${mirror}/api/v1/transactions/${toMirrorTxId(hederaTxId)}`;

  // The Mirror Node lags consensus by a few seconds.
  let tx: MirrorTx | undefined;
  for (let attempt = 0; attempt < 10 && !tx; attempt++) {
    const res = await fetch(url);
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
