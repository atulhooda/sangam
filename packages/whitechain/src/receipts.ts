import { parseEventLogs, type Hex } from "viem";
import { receiptsAddress, relayerWallet, whitechainClient } from "./chain.ts";

/** ABI of contracts/SangamReceipts.sol (the parts Sangam calls). */
export const RECEIPTS_ABI = [
  {
    type: "function",
    name: "record",
    stateMutability: "nonpayable",
    inputs: [
      { name: "paymentTx", type: "bytes32" },
      { name: "data", type: "string" },
    ],
    outputs: [
      { name: "seq", type: "uint64" },
      { name: "newHead", type: "bytes32" },
    ],
  },
  { type: "function", name: "head", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "count", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "sangam", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "receiptOf", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint64" }] },
  {
    type: "event",
    name: "Receipt",
    anonymous: false,
    inputs: [
      { name: "seq", type: "uint64", indexed: true },
      { name: "paymentTx", type: "bytes32", indexed: true },
      { name: "prev", type: "bytes32", indexed: false },
      { name: "head", type: "bytes32", indexed: false },
      { name: "dataHash", type: "bytes32", indexed: false },
      { name: "data", type: "string", indexed: false },
    ],
  },
  { type: "error", name: "NotSangam", inputs: [] },
  {
    type: "error",
    name: "AlreadyRecorded",
    inputs: [
      { name: "paymentTx", type: "bytes32" },
      { name: "seq", type: "uint64" },
    ],
  },
] as const;

export type WrittenReceipt = { seq: number; head: Hex; tx: Hex; contract: Hex };

/**
 * Write a settlement receipt to the SangamReceipts contract. The contract
 * hash-chains it to the receipt before and refuses a second receipt for the
 * same payment, so the rules hold even against Sangam's own servers.
 */
export async function writeReceipt(paymentTx: Hex, message: Record<string, unknown>): Promise<WrittenReceipt> {
  const contract = receiptsAddress();
  if (!contract) throw new Error("WHITECHAIN_RECEIPTS_ADDRESS is not set (npm run deploy-whitechain)");
  const wallet = relayerWallet();
  const data = JSON.stringify({ v: 1, kind: "sangam.settlement", rail: "whitechain", ...message });
  const tx = await wallet.writeContract({ address: contract, abi: RECEIPTS_ABI, functionName: "record", args: [paymentTx, data] });
  const receipt = await wallet.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`receipt ${tx} reverted`);
  const [event] = parseEventLogs({ abi: RECEIPTS_ABI, eventName: "Receipt", logs: receipt.logs });
  if (!event) throw new Error(`receipt ${tx} emitted no Receipt event`);
  return { seq: Number(event.args.seq), head: event.args.head, tx, contract };
}

/** Current chain tip, for the dashboard. */
export async function readReceiptsHead(): Promise<{ contract: Hex; count: number; head: Hex } | null> {
  const contract = receiptsAddress();
  if (!contract) return null;
  const client = whitechainClient();
  const [count, head] = await Promise.all([
    client.readContract({ address: contract, abi: RECEIPTS_ABI, functionName: "count" }),
    client.readContract({ address: contract, abi: RECEIPTS_ABI, functionName: "head" }),
  ]);
  return { contract, count: Number(count), head };
}
