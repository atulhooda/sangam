"use client";

import { getAddress } from "viem";
import { SEPOLIA_CHAIN_HEX } from "./wallet-link";

/* Browser-wallet helpers (MetaMask or any injected EVM wallet), on Sepolia. */

export type Eth = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
export const injected = (): Eth | undefined => (typeof window !== "undefined" ? (window as unknown as { ethereum?: Eth }).ethereum : undefined);

export function walletError(err: unknown): string {
  const e = err as { message?: string; code?: number };
  if (e.code === 4001) return "You cancelled it in the wallet.";
  return (e.message ?? "Something went wrong in the wallet.").split("\n")[0]!;
}

export async function onSepolia(provider: Eth) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_HEX }] });
  } catch (err) {
    if ((err as { code?: number }).code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: SEPOLIA_CHAIN_HEX,
          chainName: "Sepolia",
          nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        },
      ],
    });
  }
}

/** Ask for an account, switch to Sepolia, and return the checksummed address. */
export async function connectWallet(provider: Eth): Promise<string> {
  const [account] = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!account) throw new Error("No account selected.");
  await onSepolia(provider);
  return getAddress(account);
}

export async function waitForReceipt(provider: Eth, hash: string) {
  for (let i = 0; i < 90; i++) {
    const r = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (r) {
      if (r.status !== "0x1") throw new Error("The transaction failed in your wallet.");
      return;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error("Still waiting for the transaction; refresh in a minute.");
}

/** Send one transaction from the connected wallet and wait for it. Returns the hash. */
export async function sendAndWait(provider: Eth, tx: { from: string; to: string; data: string }): Promise<string> {
  await onSepolia(provider);
  const hash = (await provider.request({ method: "eth_sendTransaction", params: [tx] })) as string;
  await waitForReceipt(provider, hash);
  return hash;
}
