import "server-only";
import { keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { envOr } from "@sangam/shared";
import { listDepositAccounts } from "./identity";
import { bakeryEnsName, merchantEnsName, ondcGatewayName } from "./merchant";

/*
 * EVM addresses for the wallet rail (Sepolia), derived from one secret
 * (EVM_DEPOSIT_SEED) so Sangam never stores a key per merchant or buyer:
 *
 *   key = keccak256(seed ‖ "sangam/<kind>/" ‖ id)
 *
 *   deposit  each merchant's deposit address: its ENS name's standard address
 *            record, where wallets send USDC; Sangam can refund from it
 *   buyer    each buyer's agent: the spender the buyer approves in MetaMask
 *
 * Keep the seed fixed: the addresses already published in ENS are derived from it.
 */

function seed(): Hex | null {
  const s = envOr("EVM_DEPOSIT_SEED", "").trim();
  if (!s) return null;
  return s.startsWith("0x") ? (s as Hex) : keccak256(toBytes(s));
}

/** The wallet rail is on once a seed is set. */
export const evmWalletEnabled = () => seed() !== null;

function derive(kind: "deposit" | "buyer", id: string): Hex {
  const s = seed();
  if (!s) throw new Error("EVM_DEPOSIT_SEED is not set, so wallet payments are off");
  return keccak256(new Uint8Array([...toBytes(s), ...toBytes(`sangam/${kind}/${id.trim().toLowerCase()}`)]));
}

export const depositKey = (ensName: string) => derive("deposit", ensName);
export const depositAddress = (ensName: string) => privateKeyToAccount(depositKey(ensName)).address;
export const buyerKey = (buyerId: string) => derive("buyer", buyerId);
export const buyerAddress = (buyerId: string) => privateKeyToAccount(buyerKey(buyerId)).address;

/** Every merchant whose deposit address the watcher scans. */
export function knownMerchantNames(): string[] {
  return [...new Set([merchantEnsName(), bakeryEnsName(), ondcGatewayName(), ...listDepositAccounts().map((a) => a.ensName)])];
}
