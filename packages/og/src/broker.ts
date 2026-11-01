import { createZGComputeNetworkBroker, type ZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { ethers } from "ethers";
import { env, envOr } from "@sangam/shared";

const g = globalThis as unknown as { __sangamOgBroker?: Promise<ZGComputeNetworkBroker> };

/** The 0G Compute broker for OG_PRIVATE_KEY's wallet. Created once per process. */
export function getBroker(): Promise<ZGComputeNetworkBroker> {
  g.__sangamOgBroker ??= (async () => {
    const provider = new ethers.JsonRpcProvider(envOr("OG_RPC_URL", "https://evmrpc-testnet.0g.ai"));
    const wallet = new ethers.Wallet(env("OG_PRIVATE_KEY"), provider);
    return createZGComputeNetworkBroker(wallet);
  })().catch((err) => {
    g.__sangamOgBroker = undefined; // retry on the next call
    throw err;
  });
  return g.__sangamOgBroker;
}
