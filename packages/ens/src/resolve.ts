import { readFileSync } from "node:fs";
import path from "node:path";
import { normalize } from "viem/ens";
import { REPO_ROOT, flag, type MerchantRecord } from "@sangam/shared";
import { sepoliaClient } from "./client.ts";
import { MERCHANT_FIELDS, MERCHANT_TEXT_KEYS, type MerchantField } from "./records.ts";

const CACHE_MS = 60_000;
const g = globalThis as unknown as { __sangamEnsCache?: Map<string, { record: MerchantRecord; at: number }> };
const cache = (g.__sangamEnsCache ??= new Map());

/**
 * Look a merchant up by ENS name. This is the only place Sangam (or an agent)
 * learns a merchant's URL, Hedera account, price and UPI handle: the ENS name
 * is the merchant's identity.
 *
 * ENS_OFFLINE=true reads data/merchants.local.json instead (dev only).
 */
export async function resolveMerchant(ensName: string): Promise<MerchantRecord> {
  const hit = cache.get(ensName);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.record;

  const record = flag("ENS_OFFLINE") ? readLocalMerchant(ensName) : await readEnsMerchant(ensName);
  cache.set(ensName, { record, at: Date.now() });
  return record;
}

/** Drop a cached lookup, e.g. right after Sangam rewrites the merchant's records. */
export function forgetMerchant(ensName: string) {
  cache.delete(ensName);
}

async function readEnsMerchant(ensName: string): Promise<MerchantRecord> {
  const client = sepoliaClient();
  const name = normalize(ensName);
  const values: Partial<Record<MerchantField, string>> = {};

  await Promise.all(
    MERCHANT_FIELDS.map(async (field) => {
      const value = await client.getEnsText({ name, key: MERCHANT_TEXT_KEYS[field] });
      if (value) values[field] = value;
    }),
  );

  const missing = MERCHANT_FIELDS.filter((f) => !values[f]);
  if (missing.length > 0) {
    throw new Error(`${ensName} is missing ENS text records: ${missing.map((f) => MERCHANT_TEXT_KEYS[f]).join(", ")}`);
  }
  return toRecord(ensName, values as Record<MerchantField, string>);
}

function readLocalMerchant(ensName: string): MerchantRecord {
  const file = path.join(REPO_ROOT, "data/merchants.local.json");
  const all = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<MerchantField, string>>;
  const values = all[ensName];
  if (!values) throw new Error(`${ensName} not found in data/merchants.local.json`);
  return toRecord(ensName, values);
}

function toRecord(ensName: string, v: Record<MerchantField, string | number>): MerchantRecord {
  const priceInrPaise = Number(v.priceInrPaise);
  if (!Number.isInteger(priceInrPaise) || priceInrPaise <= 0) {
    throw new Error(`${ensName}: sangam.priceInrPaise must be a positive integer, got "${v.priceInrPaise}"`);
  }
  return {
    ensName,
    endpoint: String(v.endpoint),
    hederaPayTo: String(v.hederaPayTo),
    network: String(v.network),
    upiHandle: String(v.upiHandle),
    priceInrPaise,
  };
}
