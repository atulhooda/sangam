import { createPublicClient, createWalletClient, defineChain, http, publicActions, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env, envOr, hasEnv } from "@sangam/shared";

/*
 * Whitechain Sepolia: an OP Stack L2 (chain 1874). Sangam settles USDT here
 * the same way it settles USDC on Hedera: x402 in, deposit address per
 * merchant, on-chain receipt, refund when a payment is held.
 */

export const WHITECHAIN_CHAIN_ID = 1874;
/** CAIP-2 id used in x402 invoices. */
export const WHITECHAIN_NETWORK = `eip155:${WHITECHAIN_CHAIN_ID}` as const;

export const whitechainRpcUrl = () => envOr("WHITECHAIN_RPC_URL", "https://rpc.testnet.whitechain.io");
export const whitechainExplorerUrl = () => envOr("WHITECHAIN_EXPLORER_URL", "https://explorer.testnet.whitechain.io").replace(/\/+$/, "");

/** Whitechain's test USDT. It implements EIP-3009 (transferWithAuthorization), so payers sign and never pay gas. */
export const usdtAddress = () => envOr("WHITECHAIN_USDT", "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7") as Hex;
export const USDT_DECIMALS = 6;
/** The token's EIP-712 domain (checked against its DOMAIN_SEPARATOR on chain). */
export const USDT_EIP712 = { name: "Tether USD", version: "1" } as const;

export const whitechain = defineChain({
  id: WHITECHAIN_CHAIN_ID,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: [whitechainRpcUrl()] } },
  blockExplorers: { default: { name: "Whitechain Explorer", url: whitechainExplorerUrl() } },
  testnet: true,
});

const g = globalThis as unknown as { __sangamWhitechainClient?: ReturnType<typeof makePublicClient> };

function makePublicClient() {
  return createPublicClient({ chain: whitechain, transport: http(whitechainRpcUrl(), { timeout: 10_000, retryCount: 2 }) });
}

export function whitechainClient() {
  g.__sangamWhitechainClient ??= makePublicClient();
  return g.__sangamWhitechainClient;
}

const asKey = (k: string) => (k.startsWith("0x") ? k : `0x${k}`) as Hex;

/**
 * Sangam's relayer: the one Whitechain account that holds WBT. It submits the
 * buyers' signed USDT transfers (x402 facilitator), writes receipts and sends
 * refunds, so payers and merchants never need gas.
 */
export const relayerKey = () => asKey(env("WHITECHAIN_RELAYER_PRIVATE_KEY"));
export const relayerAccount = () => privateKeyToAccount(relayerKey());

export function relayerWallet() {
  return createWalletClient({
    account: relayerAccount(),
    chain: whitechain,
    transport: http(whitechainRpcUrl(), { timeout: 15_000, retryCount: 2 }),
  }).extend(publicActions);
}

/** The Whitechain rail is on once the relayer key is set. */
export const whitechainEnabled = () => hasEnv("WHITECHAIN_RELAYER_PRIVATE_KEY");

/** SangamReceipts contract (npm run deploy-whitechain). */
export const receiptsAddress = () => (process.env.WHITECHAIN_RECEIPTS_ADDRESS?.trim() || null) as Hex | null;

export const explorerTxUrl = (hash: string) => `${whitechainExplorerUrl()}/tx/${hash}`;
export const explorerAddressUrl = (address: string) => `${whitechainExplorerUrl()}/address/${address}`;

/** A Whitechain transaction hash (as opposed to a Hedera transaction id). */
export const isWhitechainTx = (tx: string) => /^0x[0-9a-fA-F]{64}$/.test(tx);
