import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { resolveMerchant } from "@sangam/ens";
import { findIdentity, setMerchantCert, updateMerchantShop, upsertIdentity, type VerifiedIdentity } from "./identity";

/*
 * DEMO ONLY: username/password sign-in for Sangam's own demo merchants
 * (the railway shop and the bakery), whose names Sangam issued itself, so
 * there is no person to scan a Self proof for them. Everyone else signs in
 * with Self.
 *
 *   DEMO_MERCHANT_LOGINS="railkart:<password>:tickets.sangam.eth,crumbs:<password>:bakery.sangam.eth"
 *
 * Unset means the feature is off. Credentials live only in the environment,
 * never in the repo. On first sign-in the merchant's profile is created from
 * its live ENS record (price, deposit account, URL, verified status).
 */

export type DemoLogin = { username: string; password: string; ensName: string };

export function demoLogins(): DemoLogin[] {
  return (process.env.DEMO_MERCHANT_LOGINS ?? "")
    .split(",")
    .map((entry) => entry.trim().split(":"))
    .filter((p) => p.length === 3 && p.every((x) => x.trim()))
    .map(([username, password, ensName]) => ({ username: username!.trim().toLowerCase(), password: password!, ensName: ensName!.trim().toLowerCase() }));
}

export const demoLoginsEnabled = () => demoLogins().length > 0;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time check of a username and password. Returns the login, or null. */
export function checkDemoLogin(username: string, password: string): DemoLogin | null {
  const u = username.trim().toLowerCase();
  let match: DemoLogin | null = null;
  for (const l of demoLogins()) {
    // Compare every entry, so timing doesn't reveal which usernames exist.
    const ok = timingSafeEqual(digest(l.username), digest(u)) && timingSafeEqual(digest(l.password), digest(password));
    if (ok) match = l;
  }
  return match;
}

/* A few wrong passwords in a row lock a username out for a while. */
const g = globalThis as unknown as { __sangamDemoFails?: Map<string, { n: number; until: number }> };
const fails = (g.__sangamDemoFails ??= new Map());
const MAX_FAILS = 8;
const LOCK_MS = 10 * 60_000;

export function isLockedOut(username: string): boolean {
  const f = fails.get(username.trim().toLowerCase());
  return !!f && f.n >= MAX_FAILS && f.until > Date.now();
}

export function noteFailure(username: string) {
  const key = username.trim().toLowerCase();
  const f = fails.get(key);
  const n = f && f.until > Date.now() ? f.n + 1 : 1;
  fails.set(key, { n, until: Date.now() + LOCK_MS });
}

export const clearFailures = (username: string) => fails.delete(username.trim().toLowerCase());

/**
 * The demo merchant's profile, created from its ENS record the first time it
 * signs in. The shop is marked as already set up (its name and deposit account
 * exist on chain), so signing in never re-provisions or rewrites ENS.
 */
export async function ensureDemoMerchant(login: DemoLogin): Promise<VerifiedIdentity> {
  const nullifier = `demo:${login.username}`;
  const existing = findIdentity(nullifier, "merchant");
  if (existing?.cert && existing.shop?.provisionedAt) return existing;

  const record = await resolveMerchant(login.ensName);
  const now = new Date().toISOString();
  await upsertIdentity({
    nullifier,
    role: "merchant",
    label: login.ensName,
    userId: nullifier,
    // 4 shows as "KYC ✓": verified by Sangam when it issued the name, not by a Self scan.
    attestationId: 4,
    disclosed: { name: `${login.username} (Sangam demo merchant)` },
  });
  await setMerchantCert(nullifier, {
    companyName: `${login.ensName} (Sangam demo merchant)`,
    registrationNumber: "SANGAM-DEMO",
    fileName: "issued-by-sangam",
    mime: "application/pdf",
    size: 0,
    sha256: "",
    storedAs: "",
    uploadedAt: now,
    status: "submitted",
  });
  return updateMerchantShop(nullifier, {
    upiHandle: record.upiHandle,
    priceInrPaise: record.priceInrPaise,
    // Its own endpoint, so any later re-provisioning keeps the URL already on ENS.
    endpoint: record.endpoint,
    depositAccountId: record.hederaPayTo,
    publishedUrl: record.endpoint,
    ensTxs: [],
    provisionedAt: now,
    error: undefined,
  });
}
