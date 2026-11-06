import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/*
 * Merchant passwords. A merchant sets one after its Self proof and claiming
 * its ENS name, then signs in with name + password or with Self again.
 * Stored as scrypt hashes (per-password salt); the password itself is never kept.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

export type PasswordHash = { algo: "scrypt"; salt: string; hash: string; setAt: string };

export const MIN_PASSWORD = 8;

/** Why a password isn't acceptable, or null. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return "That password is too long.";
  if (/^(.)\1+$/.test(pw) || /^(?:12345678|password|qwerty)/i.test(pw)) return "That password is too easy to guess.";
  return null;
}

export async function hashPassword(pw: string): Promise<PasswordHash> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, KEYLEN, PARAMS);
  return { algo: "scrypt", salt: salt.toString("base64"), hash: hash.toString("base64"), setAt: new Date().toISOString() };
}

export async function verifyPassword(pw: string, stored: PasswordHash): Promise<boolean> {
  const hash = await scrypt(pw, Buffer.from(stored.salt, "base64"), KEYLEN, PARAMS);
  const want = Buffer.from(stored.hash, "base64");
  return hash.length === want.length && timingSafeEqual(hash, want);
}

/** Spend the same time on an unknown name as on a wrong password, so names can't be probed by timing. */
const DUMMY: PasswordHash = { algo: "scrypt", salt: "AAAAAAAAAAAAAAAAAAAAAA==", hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", setAt: "" };
export const burnPasswordCheck = (pw: string) => verifyPassword(pw, DUMMY).then(() => false);
