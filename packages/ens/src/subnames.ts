import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, labelhash, toHex, type Hex } from "viem";
import { normalize, packetToBytes } from "viem/ens";
import { REPO_ROOT, flag, type MerchantRecord } from "@sangam/shared";
import { sepoliaClient } from "./client.ts";
import { ENSV2_SEPOLIA, REGISTRY_ABI, REGISTRY_ROLES, RESOLVER_ABI } from "./contracts.ts";
import { EVM_COIN_TYPES, MERCHANT_FIELDS, MERCHANT_TEXT_KEYS, STATUS_TEXT_KEY, type MerchantStatus } from "./records.ts";
import { forgetMerchant } from "./resolve.ts";
import { parentName, sangamContracts, sangamWallet } from "./wallet.ts";

/*
 * Sangam as an ENS merchant registry. Every merchant gets a subname under
 * sangam.eth (tickets.sangam.eth, ondc-<seller>.sangam.eth, …), issued by
 * Sangam, so the merchant never needs a wallet, ETH or an ENS name of its own.
 *
 * Each subname is a real ENSv2 name: an ERC-1155 token in Sangam's UserRegistry,
 * pointing at Sangam's PermissionedResolver, which holds the five Sangam text
 * records. Sangam keeps the token for now; ROLE_CAN_TRANSFER_ADMIN lets it hand
 * the name to the merchant later if the merchant wants custody.
 */

export type MerchantInput = Omit<MerchantRecord, "ensName" | "priceInrPaise" | "status" | "evmPayTo"> & {
  /** Written as the name's standard address record (coin type 60) when given. */
  evmPayTo?: string;
  priceInrPaise: number | string;
  /** Written as sangam.status when given; left untouched otherwise. */
  status?: MerchantStatus;
};

export type IssuedSubname = {
  name: string;
  registered: boolean;
  txs: { step: string; tx: Hex }[];
  offline: boolean;
};

/** Subname labels: lowercase letters, digits and hyphens, 3–63 chars, no leading/trailing hyphen. */
export function validLabel(label: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(label);
}

export const subnameFor = (label: string) => `${label}.${parentName()}`;

/** Owner roles on each merchant token: Sangam can repoint, renew and transfer it. */
const SUBNAME_ROLES =
  REGISTRY_ROLES.ROLE_SET_RESOLVER | REGISTRY_ROLES.ROLE_RENEW | REGISTRY_ROLES.ROLE_CAN_TRANSFER_ADMIN;

/**
 * Issue (or update) <label>.sangam.eth for a merchant and write its records.
 * Idempotent: an existing subname only gets its records rewritten.
 *
 * ENS_OFFLINE=true writes data/merchants.local.json instead, so onboarding
 * works the same way before any keys exist.
 */
export async function issueSubname(label: string, merchant: MerchantInput, log: (msg: string) => void = () => undefined): Promise<IssuedSubname> {
  if (!validLabel(label)) throw new Error(`invalid label "${label}": use 3–63 lowercase letters, digits or hyphens`);
  const price = Number(merchant.priceInrPaise);
  if (!Number.isInteger(price) || price <= 0) throw new Error(`priceInrPaise must be a positive integer, got "${merchant.priceInrPaise}"`);
  const name = normalize(subnameFor(label));
  const values: Record<string, string> = Object.fromEntries(MERCHANT_FIELDS.map((f) => [f, String(f === "priceInrPaise" ? price : merchant[f])]));

  if (flag("ENS_OFFLINE")) {
    const file = path.join(REPO_ROOT, "data/merchants.local.json");
    const all = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, string>>;
    const registered = !all[name];
    all[name] = {
      ...values,
      ...(merchant.status ? { status: merchant.status } : {}),
    };
    writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
    forgetMerchant(name);
    log(`[offline] wrote ${name} to data/merchants.local.json`);
    return { name, registered, txs: [], offline: true };
  }

  const wallet = sangamWallet();
  const client = sepoliaClient();
  const { registry, resolver } = sangamContracts();
  const txs: IssuedSubname["txs"] = [];

  // 1. Register the subname in Sangam's UserRegistry, unless it already exists.
  const existingResolver = await client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getResolver", args: [label] });
  let registered = false;
  if (existingResolver === "0x0000000000000000000000000000000000000000") {
    // A subname can't outlive its parent, so it expires with sangam.eth (renewed alongside it).
    const parentLabel = parentName().split(".")[0]!;
    const expiry = await client.readContract({ address: ENSV2_SEPOLIA.ETHRegistry, abi: REGISTRY_ABI, functionName: "getExpiry", args: [BigInt(labelhash(parentLabel))] });
    log(`registering ${name}…`);
    try {
      const tx = await wallet.writeContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: "register",
        args: [label, wallet.account.address, "0x0000000000000000000000000000000000000000", resolver, SUBNAME_ROLES, expiry],
      });
      await client.waitForTransactionReceipt({ hash: tx });
      txs.push({ step: "register", tx });
      registered = true;
    } catch (err) {
      const revert = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
      if (!(revert instanceof ContractFunctionRevertedError && revert.data?.errorName === "LabelAlreadyRegistered")) throw err;
    }
  } else if (existingResolver.toLowerCase() !== resolver.toLowerCase()) {
    log(`pointing ${name} at Sangam's resolver…`);
    const tx = await wallet.writeContract({ address: registry, abi: REGISTRY_ABI, functionName: "setResolver", args: [BigInt(labelhash(label)), resolver] });
    await client.waitForTransactionReceipt({ hash: tx });
    txs.push({ step: "setResolver", tx });
  }

  // 2. Write all the records (five, plus sangam.status when given) in one transaction.
  const dnsName = toHex(packetToBytes(name));
  const calls = MERCHANT_FIELDS.map((f) =>
    encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [dnsName, MERCHANT_TEXT_KEYS[f], values[f]!] }),
  );
  if (merchant.status) {
    calls.push(encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [dnsName, STATUS_TEXT_KEY, merchant.status] }));
  }
  if (merchant.evmPayTo) {
    for (const coinType of EVM_COIN_TYPES) {
      calls.push(encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setAddress", args: [dnsName, coinType, merchant.evmPayTo as `0x${string}`] }));
    }
  }
  log(`writing ${calls.length} records on ${name}…`);
  const tx = await wallet.writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: "multicall", args: [calls] });
  await client.waitForTransactionReceipt({ hash: tx });
  txs.push({ step: "records", tx });
  forgetMerchant(name);

  return { name, registered, txs, offline: false };
}
