import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, type Settlement } from "@sangam/shared";

const file = path.join(REPO_ROOT, "data/settlements.json");
mkdirSync(path.dirname(file), { recursive: true });

const items: Settlement[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
let writing: Promise<void> = Promise.resolve();

function persist() {
  const snapshot = JSON.stringify(items, null, 2);
  writing = writing.then(async () => {
    await writeFile(`${file}.tmp`, snapshot);
    await rename(`${file}.tmp`, file);
  });
  return writing;
}

export function listSettlements(): Settlement[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findByTx(hederaTxId: string): Settlement | undefined {
  return items.find((s) => s.hederaTxId === hederaTxId);
}

export function recentFromPayer(payer: string, withinMs: number): Settlement[] {
  const since = Date.now() - withinMs;
  return items.filter((s) => s.payer === payer && Date.parse(s.createdAt) >= since);
}

export function recentForMerchant(merchant: string, limit: number): Settlement[] {
  return listSettlements().filter((s) => s.merchant === merchant).slice(0, limit);
}

export async function insertSettlement(s: Settlement) {
  items.push(s);
  await persist();
}

export async function updateSettlement(id: string, patch: Partial<Settlement>): Promise<Settlement> {
  const s = items.find((x) => x.id === id);
  if (!s) throw new Error(`settlement ${id} not found`);
  Object.assign(s, patch, { updatedAt: new Date().toISOString() });
  await persist();
  return s;
}
