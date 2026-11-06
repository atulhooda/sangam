import { keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { envOr } from "@sangam/shared";
import { relayerKey } from "./chain.ts";

/*
 * Per-merchant deposit addresses and per-buyer agent wallets, derived from one
 * secret (WHITECHAIN_DEPOSIT_SEED, or the relayer key when unset):
 *
 *   key = keccak256(seed ‖ "sangam/<kind>/" ‖ id)
 *
 * Creating an EVM address needs no transaction, so this replaces Hedera's
 * AccountCreate: a merchant's address exists the moment it is derived, and
 * Sangam never stores a key per merchant. Sangam can always re-derive the key
 * to refund from the address (gaslessly, through the relayer).
 */

function seed(): Hex {
  const s = envOr("WHITECHAIN_DEPOSIT_SEED", "").trim();
  return s ? (s.startsWith("0x") ? (s as Hex) : keccak256(toBytes(s))) : relayerKey();
}

function derive(kind: "deposit" | "buyer", id: string): Hex {
  return keccak256(new Uint8Array([...toBytes(seed()), ...toBytes(`sangam/${kind}/${id.trim().toLowerCase()}`)]));
}

/** The merchant's own deposit address on Whitechain (published as sangam.payTo.whitechain). */
export const depositKey = (ensName: string) => derive("deposit", ensName);
export const depositAddress = (ensName: string) => privateKeyToAccount(depositKey(ensName)).address;

/** A buyer's agent wallet on Whitechain, keyed by the buyer's Sangam identity. */
export const buyerKey = (buyerId: string) => derive("buyer", buyerId);
export const buyerAddress = (buyerId: string) => privateKeyToAccount(buyerKey(buyerId)).address;
