import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { env, envOr } from "@sangam/shared";

/** Sangam's ENS key: owns the parent name (sangam.eth), its registry and resolver. */
export function sangamWallet() {
  const key = env("ENS_OWNER_PRIVATE_KEY");
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
  return createWalletClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL || undefined), account });
}

/** The parent every merchant name lives under. */
export const parentName = () => envOr("ENS_PARENT_NAME", "sangam.eth");

/** Contracts written by `npm run setup-ens`. */
export function sangamContracts() {
  return {
    registry: env("ENS_SANGAM_REGISTRY") as Hex,
    resolver: env("ENS_SANGAM_RESOLVER") as Hex,
  };
}
