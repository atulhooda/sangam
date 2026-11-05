// Associate testnet USDC with the customer and treasury accounts (an account
// can't receive an HTS token until it's associated), then print every
// account's HBAR and USDC balance. Safe to re-run.
//   npm run setup-hedera
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client, PrivateKey, TokenAssociateTransaction } from "@hiero-ledger/sdk";
import { HEDERA_TESTNET_USDC } from "@x402/hedera";
import { REPO_ROOT, env, envOr, flag } from "@sangam/shared";

const token = envOr("HEDERA_USDC_TOKEN_ID", HEDERA_TESTNET_USDC);
const mirror = envOr("MIRROR_NODE_URL", "https://testnet.mirrornode.hedera.com");

const accounts = [
  { role: "customer", id: env("CUSTOMER_ACCOUNT_ID"), key: env("CUSTOMER_PRIVATE_KEY"), needsUsdc: true },
  { role: "treasury", id: env("TREASURY_ACCOUNT_ID"), key: env("TREASURY_PRIVATE_KEY"), needsUsdc: true },
  { role: "operator", id: env("OPERATOR_ACCOUNT_ID"), key: env("OPERATOR_PRIVATE_KEY"), needsUsdc: false },
];

async function usdcBalance(accountId: string): Promise<bigint | null> {
  const res = await fetch(`${mirror}/api/v1/accounts/${accountId}/tokens?token.id=${token}`);
  if (!res.ok) throw new Error(`mirror node ${res.status} for ${accountId}`);
  const { tokens } = (await res.json()) as { tokens: { balance: number }[] };
  return tokens[0] ? BigInt(tokens[0].balance) : null; // null = not associated
}

async function hbarBalance(accountId: string): Promise<number> {
  const res = await fetch(`${mirror}/api/v1/accounts/${accountId}`);
  if (!res.ok) throw new Error(`mirror node ${res.status} for ${accountId}`);
  const { balance } = (await res.json()) as { balance: { balance: number } };
  return balance.balance / 1e8;
}

for (const a of accounts) {
  let usdc = await usdcBalance(a.id);
  if (a.needsUsdc && usdc === null) {
    console.log(`${a.role} ${a.id}: associating USDC ${token}…`);
    const key = PrivateKey.fromStringECDSA(a.key);
    const client = Client.forTestnet().setOperator(a.id, key);
    const tx = await new TokenAssociateTransaction().setAccountId(a.id).setTokenIds([token]).execute(client);
    await tx.getReceipt(client);
    client.close();
    // The mirror node lags consensus by a few seconds.
    await new Promise((r) => setTimeout(r, 4_000));
    usdc = await usdcBalance(a.id);
  }
  const usdcText = usdc === null ? "not associated" : `${(Number(usdc) / 1e6).toFixed(2)} USDC`;
  console.log(`${a.role.padEnd(9)} ${a.id.padEnd(14)} ${(await hbarBalance(a.id)).toFixed(2).padStart(10)} HBAR   ${usdcText}`);
}

// In ENS_OFFLINE mode the merchant's payTo comes from the local file, so it must be the treasury.
if (flag("ENS_OFFLINE")) {
  const local = JSON.parse(readFileSync(path.join(REPO_ROOT, "data/merchants.local.json"), "utf8"));
  const payTo = local[env("MERCHANT_ENS_NAME")]?.hederaPayTo;
  if (payTo !== env("TREASURY_ACCOUNT_ID")) {
    console.warn(`\n⚠ data/merchants.local.json has hederaPayTo ${payTo}; set it to your treasury ${env("TREASURY_ACCOUNT_ID")}`);
  }
}
