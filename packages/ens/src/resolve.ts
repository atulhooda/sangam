import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalize } from "viem/ens";
import { DATA_DIR, REPO_ROOT, flag, type MerchantRecord } from "@sangam/shared";
import { sepoliaClient } from "./client.ts";
import { BARGAIN_TEXT_KEY, MERCHANT_FIELDS, MERCHANT_TEXT_KEYS, STATUS_TEXT_KEY, parseBargainBps, type MerchantField } from "./records.ts";

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

  if (flag("ENS_OFFLINE")) {
    const record = readLocalMerchant(ensName);
    cache.set(ensName, { record, at: Date.now() });
    return record;
  }
  try {
    const record = await readEnsMerchant(ensName);
    cache.set(ensName, { record, at: Date.now() });
    rememberLastGood(ensName, record);
    return record;
  } catch (err) {
    // Sepolia unreachable: use the last records actually read from ENS, if any.
    // Never the hand-written local file: a stale payTo there would misdirect real USDC.
    const last = hit?.record ?? readLastGood(ensName);
    if (last && isNetworkError(err)) {
      console.warn(`[ens] ${ensName}: Sepolia RPC failed (${(err as Error).message.split("\n")[0]}); using last records read from ENS`);
      return last;
    }
    throw err;
  }
}

/* Last records successfully read from ENS, kept on disk so a restart survives an RPC outage. */
const LAST_GOOD_FILE = path.join(DATA_DIR, "ens-cache.local.json");

function readLastGood(ensName: string): MerchantRecord | undefined {
  if (!existsSync(LAST_GOOD_FILE)) return undefined;
  try {
    return (JSON.parse(readFileSync(LAST_GOOD_FILE, "utf8")) as Record<string, MerchantRecord>)[ensName];
  } catch {
    return undefined;
  }
}

function rememberLastGood(ensName: string, record: MerchantRecord) {
  try {
    const all = existsSync(LAST_GOOD_FILE) ? (JSON.parse(readFileSync(LAST_GOOD_FILE, "utf8")) as Record<string, MerchantRecord>) : {};
    if (JSON.stringify(all[ensName]) === JSON.stringify(record)) return;
    all[ensName] = record;
    writeFileSync(LAST_GOOD_FILE, JSON.stringify(all, null, 2));
  } catch {
    // best effort
  }
}

function isNetworkError(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err);
  return /timed? ?out|took too long|fetch failed|ECONN|ENOTFOUND|HTTP request failed|rate limit|429|5\d\d/i.test(m);
}

/** Drop a cached lookup, e.g. right after Sangam rewrites the merchant's records. */
export function forgetMerchant(ensName: string) {
  cache.delete(ensName);
}

async function readEnsMerchant(ensName: string): Promise<MerchantRecord> {
  const client = sepoliaClient();
  const name = normalize(ensName);
  const values: Partial<Record<MerchantField, string>> = {};

  let status: string | undefined;
  let evmPayTo: string | undefined;
  let bargain: string | undefined;
  await Promise.all([
    ...MERCHANT_FIELDS.map(async (field) => {
      const value = await client.getEnsText({ name, key: MERCHANT_TEXT_KEYS[field] });
      if (value) values[field] = value;
    }),
    client.getEnsText({ name, key: STATUS_TEXT_KEY }).then((v) => {
      if (v) status = v;
    }),
    client.getEnsText({ name, key: BARGAIN_TEXT_KEY }).then(
      (v) => {
        if (v) bargain = v;
      },
      () => undefined,
    ),
    client.getEnsAddress({ name }).then(
      (v) => {
        if (v && v !== "0x0000000000000000000000000000000000000000") evmPayTo = v;
      },
      () => undefined,
    ),
  ]);

  const missing = MERCHANT_FIELDS.filter((f) => !values[f]);
  if (missing.length > 0) {
    throw new Error(`${ensName} is missing ENS text records: ${missing.map((f) => MERCHANT_TEXT_KEYS[f]).join(", ")}`);
  }
  return {
    ...toRecord(ensName, values as Record<MerchantField, string>),
    bargainBps: parseBargainBps(bargain),
    ...(status ? { status } : {}),
    ...(evmPayTo ? { evmPayTo } : {}),
  };
}

function readLocalMerchant(ensName: string): MerchantRecord {
  const file = path.join(DATA_DIR, "merchants.local.json");
  const all = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<MerchantField, string>>;
  const values = all[ensName];
  if (!values) throw new Error(`${ensName} not found in data/merchants.local.json`);
  const { status, bargain } = values as Record<string, string>;
  return { ...toRecord(ensName, values), bargainBps: parseBargainBps(bargain), ...(status ? { status } : {}) };
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
