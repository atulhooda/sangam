import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const g = globalThis as unknown as { __sangamEnsClient?: ReturnType<typeof createPublicClient> };

/** Sepolia client (ENS testnet). SEPOLIA_RPC_URL blank = viem's public RPC. */
export function sepoliaClient() {
  g.__sangamEnsClient ??= createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL || undefined) });
  return g.__sangamEnsClient;
}
