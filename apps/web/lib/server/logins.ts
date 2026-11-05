import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Role } from "./identity";

/*
 * A sign-in in progress. The Self proof is POSTed to /api/self/verify by
 * Self's relayer, not by the browser, so it can't set a cookie. Instead:
 *
 *   1. /api/auth/start   the browser gets a fresh Self userId for its QR and
 *                        a secret in an httpOnly cookie (only its hash is kept)
 *   2. /api/self/verify  the proof names that userId; the login is marked
 *                        verified with the person's nullifier
 *   3. /api/auth/complete the same browser shows the secret and gets a session
 *
 * Someone who photographs the QR can't sign in: they don't have the cookie.
 * Kept in memory (one server process); a restart mid-sign-in just means
 * scanning again.
 */

export const LOGIN_COOKIE = "sangam_login";
export const LOGIN_TTL_S = 10 * 60;

export type PendingLogin = {
  userId: string;
  secretHash: string;
  role: Role;
  label: string;
  createdAt: number;
  nullifier?: string;
  error?: string;
};

const g = globalThis as unknown as { __sangamLogins?: Map<string, PendingLogin> };
const logins = (g.__sangamLogins ??= new Map());

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
/** Self returns the uuid via BigInt → hex, which drops leading zeros. */
const norm = (uuid: string) => uuid.toLowerCase().replace(/-/g, "").replace(/^0+/, "");

function sweep() {
  const cutoff = Date.now() - LOGIN_TTL_S * 1000;
  for (const [k, v] of logins) if (v.createdAt < cutoff) logins.delete(k);
}

export function startLogin(role: Role, label: string): { userId: string; secret: string } {
  sweep();
  const userId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  logins.set(norm(userId), { userId, secretHash: hash(secret), role, label, createdAt: Date.now() });
  return { userId, secret };
}

export function findLoginByUserId(userId: string): PendingLogin | undefined {
  sweep();
  return logins.get(norm(userId));
}

export function findLoginBySecret(secret: string | undefined): PendingLogin | undefined {
  if (!secret) return undefined;
  sweep();
  const h = hash(secret);
  for (const l of logins.values()) if (l.secretHash === h) return l;
  return undefined;
}

export function finishLogin(login: PendingLogin) {
  logins.delete(norm(login.userId));
}
