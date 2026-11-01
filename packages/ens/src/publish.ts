import { createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { namehash, normalize } from "viem/ens";
import { env, type MerchantRecord } from "@sangam/shared";
import { sepoliaClient } from "./client.ts";
import { MERCHANT_FIELDS, MERCHANT_TEXT_KEYS } from "./records.ts";

const RESOLVER_ABI = parseAbi(["function setText(bytes32 node, string key, string value)"]);

export type PublishedRecord = { key: string; value: string; txHash: Hex };

/**
 * Write a merchant's Sangam text records on an ENS name ENS_OWNER_PRIVATE_KEY
 * controls (Sepolia). The name must already exist. The resolver is looked up
 * every time rather than hard-coded, as the ENSv2 docs advise.
 */
export async function publishMerchant(
  record: Omit<MerchantRecord, "priceInrPaise"> & { priceInrPaise: number | string },
  onRecord?: (r: PublishedRecord) => void,
): Promise<PublishedRecord[]> {
  const publicClient = sepoliaClient();
  const ownerKey = env("ENS_OWNER_PRIVATE_KEY");
  const account = privateKeyToAccount((ownerKey.startsWith("0x") ? ownerKey : `0x${ownerKey}`) as Hex);
  const wallet = createWalletClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL || undefined), account });

  const name = normalize(record.ensName);
  const resolver = await publicClient.getEnsResolver({ name });
  const node = namehash(name);

  const out: PublishedRecord[] = [];
  for (const field of MERCHANT_FIELDS) {
    const key = MERCHANT_TEXT_KEYS[field];
    const value = String(record[field]);
    const txHash = await wallet.writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: "setText", args: [node, key, value] });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    const r = { key, value, txHash };
    out.push(r);
    onRecord?.(r);
  }
  return out;
}
