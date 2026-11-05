import "server-only";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Settlement } from "../types";

/** Repo root: `next dev` runs with cwd = apps/web. */
export const REPO_ROOT = path.resolve(process.cwd(), "../..");
const FILE = path.join(REPO_ROOT, "data/settlements.json");

/*
 * Same flat-file store the old settlement-agent used (data/settlements.json),
 * so existing records carry over. Route handlers can load as separate module
 * instances in dev, so state lives on globalThis and every write is serialised
 * through one promise chain, reading the file fresh each time.
 */
type StoreState = { lock: Promise<unknown> };
const g = globalThis as unknown as { __sangamStore?: StoreState };
const state: StoreState = (g.__sangamStore ??= { lock: Promise.resolve() });

function readAll(): Settlement[] {
  if (!existsSync(FILE)) return [];
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Settlement[];
  } catch {
    return [];
  }
}

async function writeAll(items: Settlement[]) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(items, null, 2));
  await rename(`${FILE}.tmp`, FILE);
}

/** Run a read-modify-write under the store lock. */
function withLock<T>(fn: (items: Settlement[]) => T | Promise<T>): Promise<T> {
  const run = state.lock.then(async () => {
    const items = readAll();
    const result = await fn(items);
    await writeAll(items);
    return result;
  });
  state.lock = run.catch(() => undefined);
  return run;
}

export function listSettlements(): Settlement[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findByTx(hederaTxId: string): Settlement | undefined {
  return readAll().find((s) => s.hederaTxId === hederaTxId);
}

export function recentFromPayer(payer: string, withinMs: number): Settlement[] {
  const since = Date.now() - withinMs;
  return readAll().filter((s) => s.payer === payer && Date.parse(s.createdAt) >= since);
}

export function insertSettlement(s: Settlement): Promise<void> {
  return withLock((items) => {
    items.push(s);
  });
}

export function updateSettlement(id: string, patch: Partial<Settlement>): Promise<Settlement> {
  return withLock((items) => {
    const s = items.find((x) => x.id === id);
    if (!s) throw new Error(`settlement ${id} not found`);
    Object.assign(s, patch, { updatedAt: new Date().toISOString() });
    return { ...s };
  });
}
