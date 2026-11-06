import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@sangam/shared";
import type { PasswordHash } from "./passwords";

const FILE = path.join(DATA_DIR, "identities.local.json");

/*
 * Verified identities (merchants and users), proved with the Self offchain
 * SDK from an Aadhaar QR (or a passport). We store only what the proof
 * chose to disclose — never the Aadhaar number. The nullifier is Self's
 * anti-reuse identifier: stable per person per app scope, useless to anyone
 * else, so it's the id we dedupe on.
 *
 * One row per person per role: the same person can be a buyer and, with a
 * separate sign-in and a company certificate, a merchant. A session carries
 * one role, so a buyer session never opens a merchant desk.
 */

export type Role = "merchant" | "user";

export type MerchantCert = {
  companyName: string;
  /** GSTIN / CIN / company registration number, as the merchant typed it. */
  registrationNumber: string;
  fileName: string;
  mime: "application/pdf" | "image/png" | "image/jpeg";
  size: number;
  sha256: string;
  /** File name inside DATA_DIR/certs (on the Railway volume in production). */
  storedAs: string;
  uploadedAt: string;
  /** No reviewer workflow yet: "submitted" opens the desk. */
  status: "submitted";
};

/**
 * What Sangam set up for a merchant after the certificate: its own Hedera
 * deposit account and its <label>.sangam.eth records (sangam.status=verified).
 */
export type MerchantShop = {
  upiHandle: string;
  priceInrPaise: number;
  /** The merchant's own x402 endpoint, if it has one; otherwise Sangam's pay link. */
  endpoint: string | null;
  /** Its own Hedera account (sangam.payTo). Created once, kept across retries. */
  depositAccountId?: string;
  /** The url written to ENS. */
  publishedUrl?: string;
  ensTxs?: { step: string; tx: string }[];
  /** Set when ENS + Hedera setup finished; cleared when the shop details change. */
  provisionedAt?: string;
  /** Last setup failure, shown on the desk with a retry button. */
  error?: string;
};

/**
 * A buyer's agent wallet: its own Hedera account, created by Sangam and keyed
 * to the operator, so the buyer's agent can sign x402 payments without an
 * approval prompt (custodial, testnet). Funded from the demo faucet or any
 * wallet.
 */
export type BuyerWallet = {
  accountId: string;
  createdAt: string;
  /** Test USDC sent by Sangam's faucet so far (atomic units), capped per buyer. */
  fundedAtomic: string;
};

export type VerifiedIdentity = {
  /** Self nullifier: one per person per scope. With role, the row's key. */
  nullifier: string;
  role: Role;
  /**
   * A merchant's ENS name (<label>.sangam.eth), empty until the merchant claims
   * one after its Self proof. Unused for buyers.
   */
  label: string;
  /** Merchants: set after claiming the name, for name + password sign-in. */
  password?: PasswordHash;
  /** Self-generated user identifier (a UUID the desk page assigned). */
  userId: string;
  /** 1 = passport, 2 = EU ID card, 3 = Aadhaar. */
  attestationId: number;
  /** What the proof disclosed (name, date_of_birth, …); only non-empty fields. */
  disclosed: Record<string, string>;
  /** Merchants only: the company certificate uploaded after the Self proof. */
  cert?: MerchantCert;
  /** Merchants only: deposit account + ENS records, set up after the certificate. */
  shop?: MerchantShop;
  /** Buyers only: the agent's own Hedera wallet. */
  wallet?: BuyerWallet;
  verifiedAt: string;
  updatedAt: string;
};

type StoreState = { lock: Promise<unknown> };
const g = globalThis as unknown as { __sangamIdentities?: StoreState };
const state = (g.__sangamIdentities ??= { lock: Promise.resolve() });

function readAll(): VerifiedIdentity[] {
  if (!existsSync(FILE)) return [];
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as VerifiedIdentity[];
  } catch {
    return [];
  }
}

async function writeAll(items: VerifiedIdentity[]) {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(items, null, 2));
  await rename(`${FILE}.tmp`, FILE);
}

async function withLock<T>(fn: (items: VerifiedIdentity[]) => T | Promise<T>): Promise<T> {
  const run = state.lock.then(async () => {
    const items = readAll();
    const result = await fn(items);
    await writeAll(items);
    return result;
  });
  state.lock = run.catch(() => undefined);
  return run;
}

export function listIdentities(): VerifiedIdentity[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function findIdentity(nullifier: string, role: Role): VerifiedIdentity | undefined {
  return readAll().find((i) => i.nullifier === nullifier && i.role === role);
}

export class LabelTakenError extends Error {}

/**
 * Record a verified person in a role. A merchant name belongs to whoever
 * proved it first: another person claiming it gets LabelTakenError.
 * Re-verifying refreshes the disclosures and keeps the certificate.
 */
export async function upsertIdentity(
  identity: Omit<VerifiedIdentity, "verifiedAt" | "updatedAt" | "cert" | "shop" | "wallet" | "password">,
): Promise<VerifiedIdentity> {
  return withLock((items) => {
    // Signing in again with Self (no name given) keeps the name already claimed.
    if (identity.role === "merchant" && !identity.label) {
      const mine = items.find((i) => i.nullifier === identity.nullifier && i.role === "merchant");
      identity = { ...identity, label: mine?.label ?? "" };
    }
    if (identity.role === "merchant" && identity.label) {
      const owner = items.find((i) => i.role === "merchant" && i.label.toLowerCase() === identity.label.toLowerCase());
      if (owner && owner.nullifier !== identity.nullifier) {
        throw new LabelTakenError(`${identity.label} is already registered to another merchant`);
      }
    }
    const now = new Date().toISOString();
    const existing = items.find((i) => i.nullifier === identity.nullifier && i.role === identity.role);
    if (existing) {
      // A merchant moving to a different name starts over with a new certificate.
      const keepCert = existing.role !== "merchant" || existing.label.toLowerCase() === identity.label.toLowerCase();
      Object.assign(existing, identity, { updatedAt: now });
      if (!keepCert) {
        delete existing.cert;
        delete existing.shop;
      }
      return { ...existing };
    }
    const row: VerifiedIdentity = { ...identity, verifiedAt: now, updatedAt: now };
    items.push(row);
    return row;
  });
}

/** The merchant who owns a name (bakery or bakery.sangam.eth), if any. */
export function findMerchantByLabel(ensName: string): VerifiedIdentity | undefined {
  const name = ensName.trim().toLowerCase();
  return readAll().find((i) => i.role === "merchant" && i.label.toLowerCase() === name);
}

/** Give a verified merchant its name. First come, first served; a merchant keeps the name it claimed. */
export async function claimMerchantLabel(nullifier: string, ensName: string): Promise<VerifiedIdentity> {
  return withLock((items) => {
    const row = items.find((i) => i.nullifier === nullifier && i.role === "merchant");
    if (!row) throw new Error("no merchant identity for this session");
    const name = ensName.toLowerCase();
    if (row.label && row.label !== name && row.shop?.provisionedAt) throw new Error(`You already own ${row.label}.`);
    const owner = items.find((i) => i.role === "merchant" && i.label.toLowerCase() === name && i.nullifier !== nullifier);
    if (owner) throw new LabelTakenError(`${name} was just claimed by another merchant. Pick another.`);
    row.label = name;
    row.updatedAt = new Date().toISOString();
    return { ...row };
  });
}

export async function setMerchantPassword(nullifier: string, password: PasswordHash): Promise<VerifiedIdentity> {
  return withLock((items) => {
    const row = items.find((i) => i.nullifier === nullifier && i.role === "merchant");
    if (!row) throw new Error("no merchant identity for this session");
    row.password = password;
    row.updatedAt = new Date().toISOString();
    return { ...row };
  });
}

export async function setMerchantCert(nullifier: string, cert: MerchantCert): Promise<VerifiedIdentity> {
  return withLock((items) => {
    const row = items.find((i) => i.nullifier === nullifier && i.role === "merchant");
    if (!row) throw new Error("no merchant identity for this session");
    row.cert = cert;
    row.updatedAt = new Date().toISOString();
    return { ...row };
  });
}

export async function updateMerchantShop(nullifier: string, patch: Partial<MerchantShop>): Promise<VerifiedIdentity> {
  return withLock((items) => {
    const row = items.find((i) => i.nullifier === nullifier && i.role === "merchant");
    if (!row) throw new Error("no merchant identity for this session");
    row.shop = { ...(row.shop ?? { upiHandle: "", priceInrPaise: 0, endpoint: null }), ...patch };
    for (const k of Object.keys(row.shop) as (keyof MerchantShop)[]) if (row.shop[k] === undefined) delete row.shop[k];
    row.updatedAt = new Date().toISOString();
    return { ...row };
  });
}

export async function setBuyerWallet(nullifier: string, wallet: BuyerWallet): Promise<VerifiedIdentity> {
  return withLock((items) => {
    const row = items.find((i) => i.nullifier === nullifier && i.role === "user");
    if (!row) throw new Error("no buyer identity for this session");
    row.wallet = wallet;
    row.updatedAt = new Date().toISOString();
    return { ...row };
  });
}

/** ENS names of merchants Sangam has provisioned, for the buyer directory. */
export function listProvisionedMerchantNames(): string[] {
  return readAll()
    .filter((i) => i.role === "merchant" && i.shop?.provisionedAt)
    .map((i) => i.label);
}

/** Merchants with their own deposit account, for the transfer watcher. */
export function listDepositAccounts(): { ensName: string; accountId: string }[] {
  return readAll()
    .filter((i) => i.role === "merchant" && i.shop?.depositAccountId && i.shop.provisionedAt)
    .map((i) => ({ ensName: i.label, accountId: i.shop!.depositAccountId! }));
}

/** Merchants anyone may see: the ENS name and badge only, no personal data. */
export function listPublicMerchants() {
  return readAll()
    .filter((i) => i.role === "merchant" && i.label)
    .map((i) => ({ role: i.role, label: i.label, attestationId: i.attestationId, certified: !!i.cert, onEns: !!i.shop?.provisionedAt }));
}
