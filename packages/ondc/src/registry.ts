import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, envOr } from "@sangam/shared";
import { generateSigningKeys, type Signer } from "./signing.ts";

/*
 * A local stand-in for the ONDC registry. On the real network each
 * participant registers its subscriber_id, unique_key_id, URL and signing
 * public key with the ONDC registry, and every receiver looks the sender's
 * key up there to verify the Authorization header. This file plays that role
 * for the two local participants:
 *
 *   BAP  Sangam (the buyer app)               callbacks at <base>/ondc
 *   BPP  Annapurna Wholesale (mock seller)    actions  at <base>/ondc-seller
 *
 * Public keys are in data/ondc-registry.local.json (committed); private keys
 * in data/ondc-keys.local.json (git-ignored). Both are generated on first use.
 * Going to ONDC staging means: register the BAP for real and swap lookup()
 * for the staging registry's /lookup.
 */

export type Role = "BAP" | "BPP";
export type Subscriber = { subscriber_id: string; unique_key_id: string; type: Role; signing_public_key: string; domain: string; city: string };

export const ONDC_DOMAIN = "ONDC:RET10"; // Retail B2B, grocery
export const ONDC_VERSION = "2.0.2";
export const ONDC_CITY = "std:020"; // Pune

export const bapId = () => envOr("ONDC_BAP_ID", "sangam-bap.local");
export const bppId = () => envOr("ONDC_MOCK_BPP_ID", "annapurna-seller.local");

const base = () => envOr("SANGAM_API_URL", "http://localhost:5173");
export const bapUri = () => `${base()}/ondc`;
export const bppUri = () => `${base()}/ondc-seller`;

const REGISTRY_FILE = () => path.join(REPO_ROOT, "data/ondc-registry.local.json");
const KEYS_FILE = () => path.join(REPO_ROOT, "data/ondc-keys.local.json");

type KeyStore = Record<string, { unique_key_id: string; privateKey: string }>;

const g = globalThis as unknown as { __sangamOndcKeys?: { registry: Subscriber[]; keys: KeyStore } };

/** Load (or create on first use) the local registry and the matching private keys. */
function load() {
  if (g.__sangamOndcKeys) return g.__sangamOndcKeys;
  let registry: Subscriber[] = existsSync(REGISTRY_FILE()) ? JSON.parse(readFileSync(REGISTRY_FILE(), "utf8")) : [];
  let keys: KeyStore = existsSync(KEYS_FILE()) ? JSON.parse(readFileSync(KEYS_FILE(), "utf8")) : {};

  let changed = false;
  for (const [id, type] of [[bapId(), "BAP"], [bppId(), "BPP"]] as const) {
    const entry = registry.find((s) => s.subscriber_id === id);
    if (entry && keys[id]?.unique_key_id === entry.unique_key_id) continue;
    // Missing entry, or a registry entry whose private key isn't on this machine: rotate.
    const k = generateSigningKeys();
    const unique_key_id = `k-${Date.now().toString(36)}`;
    registry = registry.filter((s) => s.subscriber_id !== id);
    registry.push({ subscriber_id: id, unique_key_id, type, signing_public_key: k.publicKey, domain: ONDC_DOMAIN, city: ONDC_CITY });
    keys = { ...keys, [id]: { unique_key_id, privateKey: k.privateKey } };
    changed = true;
  }
  if (changed) {
    mkdirSync(path.dirname(REGISTRY_FILE()), { recursive: true });
    writeFileSync(REGISTRY_FILE(), `${JSON.stringify(registry, null, 2)}\n`);
    writeFileSync(KEYS_FILE(), `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
  }
  g.__sangamOndcKeys = { registry, keys };
  return g.__sangamOndcKeys;
}

/** Registry lookup, shaped like ONDC's /lookup. */
export function lookup(q: { subscriber_id?: string; unique_key_id?: string; type?: Role }): Subscriber[] {
  return load().registry.filter(
    (s) =>
      (!q.subscriber_id || s.subscriber_id === q.subscriber_id) &&
      (!q.unique_key_id || s.unique_key_id === q.unique_key_id) &&
      (!q.type || s.type === q.type),
  );
}

export const publicKeyFor = (subscriberId: string, uniqueKeyId: string) =>
  lookup({ subscriber_id: subscriberId, unique_key_id: uniqueKeyId })[0]?.signing_public_key ?? null;

export function signerFor(subscriberId: string): Signer {
  const k = load().keys[subscriberId];
  if (!k) throw new Error(`no ONDC signing key for ${subscriberId}`);
  return { subscriberId, uniqueKeyId: k.unique_key_id, privateKey: k.privateKey };
}
