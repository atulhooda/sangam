import "server-only";
import { depositAddress, whitechainEnabled } from "@sangam/whitechain";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Me } from "@/lib/types";
import { findIdentity, type Role, type VerifiedIdentity } from "./identity";

/*
 * Sessions: a signed, httpOnly cookie that says "this browser proved, with
 * Self, that it is person <nullifier>" plus which roles it proved (buyer,
 * merchant or both) and which one is active. Stateless (HMAC with
 * SESSION_SECRET); every read re-checks the identity still exists in the
 * store, so deleting an identity signs that person out everywhere.
 *
 * Remembered for 30 days and renewed while in use, so a regular user scans
 * once a month at most. Proving the second role in the same browser adds it to
 * the cookie, and the account menu can switch between them without another
 * scan. Pages and APIs always check the *active* role, so a buyer session
 * still never opens a merchant desk.
 */

export const SESSION_COOKIE = "sangam_session";
const MAX_AGE_S = 30 * 24 * 60 * 60;
/** Renew when less than this much is left (the cookie slides forward while used). */
const RENEW_BELOW_S = 29 * 24 * 60 * 60;

export type Session = { sub: string; role: Role; roles: Role[]; iat: number; exp: number };

const g = globalThis as unknown as { __sangamSessionSecret?: string };

function secret(): string {
  const s = process.env.SESSION_SECRET?.trim();
  if (s) return s;
  if (!g.__sangamSessionSecret) {
    console.warn("[auth] SESSION_SECRET is not set; using a random secret, so sessions reset when the server restarts");
    g.__sangamSessionSecret = randomBytes(32).toString("hex");
  }
  return g.__sangamSessionSecret;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");
const isRole = (r: unknown): r is Role => r === "merchant" || r === "user";

function encode(s: Session): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decode(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Session>;
    if (typeof s.sub !== "string" || typeof s.exp !== "number" || s.exp * 1000 < Date.now()) return null;
    if (!isRole(s.role)) return null;
    // Older cookies carried a single role.
    const roles = Array.isArray(s.roles) ? s.roles.filter(isRole) : [];
    if (!roles.includes(s.role)) roles.push(s.role);
    return { sub: s.sub, role: s.role, roles, iat: s.iat ?? 0, exp: s.exp };
  } catch {
    return null;
  }
}

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

async function write(s: Omit<Session, "iat" | "exp">) {
  const now = Math.floor(Date.now() / 1000);
  (await cookies()).set(SESSION_COOKIE, encode({ ...s, iat: now, exp: now + MAX_AGE_S }), cookieOptions(MAX_AGE_S));
}

async function readSession(): Promise<Session | null> {
  return decode((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * Sign in as `role`. If this browser is already signed in as the same person,
 * the new role joins the ones it remembers; a different person replaces it.
 */
export async function createSession(nullifier: string, role: Role): Promise<void> {
  const prev = await readSession();
  const roles: Role[] = prev && prev.sub === nullifier ? Array.from(new Set([...prev.roles, role])) : [role];
  await write({ sub: nullifier, role, roles });
}

/** Make another already-proven role the active one. Route handlers only. */
export async function switchRole(role: Role): Promise<SignedIn | null> {
  const s = await readSession();
  if (!s || !s.roles.includes(role)) return null;
  const identity = findIdentity(s.sub, role);
  if (!identity) return null;
  await write({ sub: s.sub, role, roles: s.roles });
  return { session: { ...s, role }, identity };
}

/** Slide the expiry forward. Route handlers only (pages can't set cookies). */
export async function renewSession(): Promise<void> {
  const s = await readSession();
  if (s && s.exp - Math.floor(Date.now() / 1000) < RENEW_BELOW_S) await write({ sub: s.sub, role: s.role, roles: s.roles });
}

export async function clearSession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", cookieOptions(0));
}

export type SignedIn = { session: Session; identity: VerifiedIdentity };

/** The signed-in person, or null. Checks the signature, expiry and that the identity still exists. */
export async function currentUser(): Promise<SignedIn | null> {
  const session = await readSession();
  if (!session) return null;
  const identity = findIdentity(session.sub, session.role);
  return identity ? { session, identity } : null;
}

/** The other role this browser has proven, if its identity still exists. */
export function otherRole(me: SignedIn): Role | null {
  const other = me.session.roles.find((r) => r !== me.session.role);
  return other && findIdentity(me.session.sub, other) ? other : null;
}

/** Where a signed-in person belongs. Merchants without a certificate and shop details go to onboarding first. */
export function homeFor(identity: VerifiedIdentity): string {
  if (identity.role === "user") return "/buyer";
  if (!identity.cert || !identity.shop) return "/merchant/onboarding";
  return `/merchant/${encodeURIComponent(identity.label)}`;
}

/** What the browser may know about the signed-in person. No nullifier, no date of birth. */
export function publicMe(identity: VerifiedIdentity, switchTo: Role | null = null): Me {
  return {
    role: identity.role,
    label: identity.label,
    name: identity.disclosed.name ?? null,
    attestationId: identity.attestationId,
    verifiedAt: identity.verifiedAt,
    cert: identity.cert
      ? { companyName: identity.cert.companyName, registrationNumber: identity.cert.registrationNumber, fileName: identity.cert.fileName, uploadedAt: identity.cert.uploadedAt, status: identity.cert.status }
      : null,
    shop: identity.shop
      ? {
          upiHandle: identity.shop.upiHandle,
          priceInrPaise: identity.shop.priceInrPaise,
          endpoint: identity.shop.endpoint,
          depositAccountId: identity.shop.depositAccountId ?? null,
          whitechainDeposit: whitechainEnabled() && identity.shop.provisionedAt ? depositAddress(identity.label) : null,
          publishedUrl: identity.shop.publishedUrl ?? null,
          ensTxs: identity.shop.ensTxs ?? [],
          provisionedAt: identity.shop.provisionedAt ?? null,
          error: identity.shop.error ?? null,
        }
      : null,
    wallet: identity.wallet ? { ...identity.wallet } : null,
    home: homeFor(identity),
    switchTo,
  };
}
