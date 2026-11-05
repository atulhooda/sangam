import { createPublicClient, fallback, http } from "viem";
import { sepolia } from "viem/chains";

const g = globalThis as unknown as { __sangamEnsClientV2?: ReturnType<typeof createPublicClient> };

/** Public Sepolia RPCs, tried after SEPOLIA_RPC_URL. thirdweb (viem's default) goes last: it throttles bursts. */
const PUBLIC_SEPOLIA_RPCS = ["https://ethereum-sepolia-rpc.publicnode.com", "https://11155111.rpc.thirdweb.com"];

/**
 * Sepolia client (ENS testnet). Uses SEPOLIA_RPC_URL when set, then falls back
 * through public RPCs, so one slow endpoint doesn't take merchant lookups down.
 */
export function sepoliaTransport() {
  const own = process.env.SEPOLIA_RPC_URL?.trim();
  const urls = [...(own ? [own] : []), ...PUBLIC_SEPOLIA_RPCS.filter((u) => u !== own)];
  return fallback(
    urls.map((url) => http(url, { timeout: 8_000, retryCount: 1 })),
    { rank: false, retryCount: 1 },
  );
}

export function sepoliaClient() {
  g.__sangamEnsClientV2 ??= createPublicClient({ chain: sepolia, transport: sepoliaTransport() });
  return g.__sangamEnsClientV2;
}
