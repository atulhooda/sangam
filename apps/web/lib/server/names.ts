import "server-only";
import { REGISTRY_ABI, parentName, resolveMerchant, sangamContracts, sepoliaClient, validLabel } from "@sangam/ens";
import { flag } from "@sangam/shared";
import { findMerchantByLabel } from "./identity";

/*
 * Claiming a shop name. After its Self proof a merchant picks a label; it gets
 * <label>.sangam.eth if nobody has it: not another Sangam merchant, not
 * already on ENS, not reserved. Otherwise it gets free alternatives to pick.
 */

/** Labels Sangam keeps for itself (the ONDC gateway and sellers, the demo shops, infrastructure). */
const RESERVED = new Set(["ondc", "www", "admin", "api", "store", "sangam", "support", "help", "pay", "merchant", "buyer"]);
const isReserved = (label: string) => RESERVED.has(label) || label.startsWith("ondc-");

export type NameCheck = {
  label: string;
  name: string;
  available: boolean;
  /** Why it can't be had, in plain words. */
  reason: string | null;
  /** Free alternatives when it's taken. */
  suggestions: string[];
};

/** "Riya's Sweets!" → "riyas-sweets". */
export function normalizeLabel(raw: string): string {
  const suffix = `.${parentName()}`;
  const s = raw.trim().toLowerCase();
  return (s.endsWith(suffix) ? s.slice(0, -suffix.length) : s)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63);
}

/** Is <label>.sangam.eth already on ENS? (Covers names issued outside this app, e.g. the demo shops.) */
async function onEns(label: string): Promise<boolean> {
  if (flag("ENS_OFFLINE")) {
    return resolveMerchant(`${label}.${parentName()}`).then(
      () => true,
      () => false,
    );
  }
  const resolver = await sepoliaClient().readContract({ address: sangamContracts().registry, abi: REGISTRY_ABI, functionName: "getResolver", args: [label] });
  return resolver !== "0x0000000000000000000000000000000000000000";
}

/** Why `label` can't be claimed by this merchant, or null when it's free. */
async function blocker(label: string, claimant?: string): Promise<string | null> {
  if (!validLabel(label)) return "Use 3–63 lowercase letters, digits or hyphens.";
  if (isReserved(label)) return "That name is reserved for Sangam.";
  const owner = findMerchantByLabel(`${label}.${parentName()}`);
  if (owner) return owner.nullifier === claimant ? null : "Another merchant already has this name.";
  if (await onEns(label)) return "This name is already taken on ENS.";
  return null;
}

/** Check a name, and suggest free ones when it's taken. `claimant` is the merchant's nullifier (its own name counts as free). */
export async function checkName(raw: string, claimant?: string): Promise<NameCheck> {
  const label = normalizeLabel(raw);
  const name = `${label}.${parentName()}`;
  const reason = await blocker(label, claimant);
  if (!reason) return { label, name, available: true, reason: null, suggestions: [] };

  const base = label.slice(0, 50);
  const candidates =
    base.length >= 3
      ? [`${base}-shop`, `${base}-store`, `${base}-india`, `the-${base}`, `${base}-online`, `${base}-${(Date.now() % 900) + 100}`]
      : [`${base || "my"}-shop`, `${base || "my"}-store`, `${base || "my"}-bazaar`];
  const free: string[] = [];
  for (const c of candidates) {
    if (free.length >= 3) break;
    if (!(await blocker(c, claimant).catch(() => "error"))) free.push(c);
  }
  return { label, name, available: false, reason, suggestions: free };
}
