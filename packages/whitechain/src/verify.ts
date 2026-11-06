import { erc20Abi, isAddressEqual, parseEventLogs, type Hex } from "viem";
import { usdtAddress, whitechainClient } from "./chain.ts";

export type ConfirmedPayment = { credited: bigint; payer: string | null };

/**
 * Check on Whitechain that the transaction succeeded and moved at least
 * `claimed` USDT units into `payTo`: the counterpart of the Hedera Mirror Node
 * check. Sangam never pays a merchant out on the merchant's word alone.
 *
 * Reads the transaction receipt's USDT Transfer logs, so it works whether the
 * transfer came from x402 (transferWithAuthorization) or a plain transfer.
 */
export async function confirmPayment(txHash: string, payTo: string, claimed: bigint): Promise<ConfirmedPayment> {
  const client = whitechainClient();
  const receipt = await client.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 30_000 });
  if (receipt.status !== "success") throw new Error(`transaction ${txHash} reverted`);

  const usdt = usdtAddress();
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter((l) => isAddressEqual(l.address, usdt));
  const toMerchant = transfers.filter((t) => isAddressEqual(t.args.to, payTo as Hex));
  const credited = toMerchant.reduce((sum, t) => sum + t.args.value, 0n);
  if (credited < claimed) {
    throw new Error(`deposit address credited ${credited} USDT units, notice claimed ${claimed}`);
  }
  return { credited, payer: toMerchant[0]?.args.from ?? null };
}
