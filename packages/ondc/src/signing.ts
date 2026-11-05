import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";

/*
 * ONDC request signing (ONDC developer docs, registry/signing-verification):
 *
 *   digest         = base64(BLAKE2b-512(raw body))
 *   signing string = "(created): <c>\n(expires): <e>\ndigest: BLAKE-512=<digest>"
 *   signature      = base64(Ed25519(signing string))
 *   Authorization: Signature keyId="<subscriber_id>|<unique_key_id>|ed25519",
 *     algorithm="ed25519",created="<c>",expires="<e>",
 *     headers="(created) (expires) digest",signature="<signature>"
 *
 * Keys use ONDC's format: base64 raw 32-byte public key; base64 64-byte
 * private key (32-byte seed followed by the public key, as libsodium emits).
 */

export type SigningKeys = { publicKey: string; privateKey: string };
export type Signer = { subscriberId: string; uniqueKeyId: string; privateKey: string };

const b64url = (b: Buffer) => b.toString("base64url");

export function generateSigningKeys(): SigningKeys {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string };
  const seed = Buffer.from(jwk.d, "base64url");
  const pub = Buffer.from(jwk.x, "base64url");
  return { publicKey: pub.toString("base64"), privateKey: Buffer.concat([seed, pub]).toString("base64") };
}

/** Ed25519 PKCS#8 DER prefix; the 32-byte seed follows it. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function privateKeyObject(privateKey: string): KeyObject {
  const seed = Buffer.from(privateKey, "base64").subarray(0, 32);
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
}

function publicKeyObject(publicKey: string): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: b64url(Buffer.from(publicKey, "base64")) }, format: "jwk" });
}

export function bodyDigest(body: string): string {
  return createHash("blake2b512").update(body).digest("base64");
}

const signingString = (created: number, expires: number, digest: string) =>
  `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;

/** Build the ONDC Authorization header for a request body. */
export function authorizationHeader(body: string, signer: Signer, ttlSeconds = 300): string {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + ttlSeconds;
  const sig = sign(null, Buffer.from(signingString(created, expires, bodyDigest(body))), privateKeyObject(signer.privateKey)).toString("base64");
  return (
    `Signature keyId="${signer.subscriberId}|${signer.uniqueKeyId}|ed25519",algorithm="ed25519",` +
    `created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${sig}"`
  );
}

export type ParsedAuth = { subscriberId: string; uniqueKeyId: string; created: number; expires: number; signature: string };

export function parseAuthorizationHeader(header: string): ParsedAuth | null {
  if (!header.startsWith("Signature ")) return null;
  const fields = Object.fromEntries([...header.slice(10).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const [subscriberId, uniqueKeyId, alg] = (fields.keyId ?? "").split("|");
  if (!subscriberId || !uniqueKeyId || alg !== "ed25519" || !fields.signature) return null;
  return { subscriberId, uniqueKeyId, created: Number(fields.created), expires: Number(fields.expires), signature: fields.signature };
}

/**
 * Verify an ONDC Authorization header against the raw body. `lookupKey` maps
 * (subscriber_id, unique_key_id) to the sender's registered public key.
 */
export async function verifyAuthorization(
  body: string,
  header: string | null,
  lookupKey: (subscriberId: string, uniqueKeyId: string) => Promise<string | null> | string | null,
): Promise<{ ok: true; subscriberId: string } | { ok: false; reason: string }> {
  if (!header) return { ok: false, reason: "missing Authorization header" };
  const auth = parseAuthorizationHeader(header);
  if (!auth) return { ok: false, reason: "malformed Authorization header" };
  const now = Math.floor(Date.now() / 1000);
  if (!(auth.created <= now + 5 && now <= auth.expires)) return { ok: false, reason: "signature expired or not yet valid" };
  const publicKey = await lookupKey(auth.subscriberId, auth.uniqueKeyId);
  if (!publicKey) return { ok: false, reason: `unknown subscriber ${auth.subscriberId}|${auth.uniqueKeyId}` };
  const ok = verify(
    null,
    Buffer.from(signingString(auth.created, auth.expires, bodyDigest(body))),
    publicKeyObject(publicKey),
    Buffer.from(auth.signature, "base64"),
  );
  return ok ? { ok: true, subscriberId: auth.subscriberId } : { ok: false, reason: "signature does not verify" };
}
