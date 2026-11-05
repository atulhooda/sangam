import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@sangam/shared";

const FILE = path.join(DATA_DIR, "identities.local.json");

/*
 * Verified identities (merchants and users), proved with the Self offchain
 * SDK from an Aadhaar QR (or a passport). We store only what the proof
 * chose to disclose — never the Aadhaar number. The nullifier is Self's
 * anti-reuse identifier: stable per person per app scope, useless to anyone
 * else, so it's the id we dedupe on.
 */

export type VerifiedIdentity = {
  /** Self nullifier: one per person per scope, so re-verification updates in place. */
  nullifier: string;
  role: "merchant" | "user";
  /** What the person named themselves on the desk: a merchant's ENS name, or a user label. */
  label: string;
  /** Self-generated user identifier (a UUID the desk page assigned). */
  userId: string;
  /** 1 = passport, 2 = EU ID card, 3 = Aadhaar. */
  attestationId: number;
  /** What the proof disclosed (name, date_of_birth, …); only non-empty fields. */
  disclosed: Record<string, string>;
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

export function findIdentityByNullifier(nullifier: string): VerifiedIdentity | undefined {
  return readAll().find((i) => i.nullifier === nullifier);
}

export function findIdentityByUserId(userId: string): VerifiedIdentity | undefined {
  return readAll().find((i) => i.userId === userId);
}

export async function upsertIdentity(
  identity: Omit<VerifiedIdentity, "verifiedAt" | "updatedAt">,
): Promise<VerifiedIdentity> {
  return withLock((items) => {
    const now = new Date().toISOString();
    const existing = items.find((i) => i.nullifier === identity.nullifier);
    if (existing) {
      Object.assign(existing, identity, { updatedAt: now });
      return { ...existing };
    }
    const row: VerifiedIdentity = { ...identity, verifiedAt: now, updatedAt: now };
    items.push(row);
    return row;
  });
}

/** True when this merchant (by ENS name) has a verified merchant identity. */
export function isVerifiedMerchant(ensName: string): boolean {
  return readAll().some((i) => i.role === "merchant" && i.label.toLowerCase() === ensName.toLowerCase());
}
