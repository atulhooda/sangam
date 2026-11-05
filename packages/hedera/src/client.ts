import { Client, PrivateKey } from "@hiero-ledger/sdk";
import { HEDERA_TESTNET_USDC, HEDERA_USDC_DECIMALS } from "@x402/hedera";
import { env, envOr } from "@sangam/shared";

/** CAIP-2 id x402 uses for Hedera testnet. */
export const HEDERA_NETWORK = "hedera:testnet" as const;

/** Testnet USDC is an HTS token (no smart contract involved). */
export const usdcTokenId = () => envOr("HEDERA_USDC_TOKEN_ID", HEDERA_TESTNET_USDC);
export const USDC_DECIMALS = HEDERA_USDC_DECIMALS;

export const mirrorNodeUrl = () => envOr("MIRROR_NODE_URL", "https://testnet.mirrornode.hedera.com");

const g = globalThis as unknown as { __sangamHederaOperator?: Client };

/**
 * The operator client (pays for HCS messages). One per process: Next.js can
 * load route modules more than once in dev, so it lives on globalThis.
 */
export function operatorClient(): Client {
  g.__sangamHederaOperator ??= Client.forTestnet().setOperator(
    env("OPERATOR_ACCOUNT_ID"),
    PrivateKey.fromStringECDSA(env("OPERATOR_PRIVATE_KEY")),
  );
  return g.__sangamHederaOperator;
}
