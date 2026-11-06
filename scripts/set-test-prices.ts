/**
 * Set testnet prices low, so testing spends almost no test USDC.
 * Writes sangam.priceInrPaise on each name through Sangam's shared resolver
 * (one multicall), after checking each name still uses that resolver
 * (a merchant that owns its name sets its own price).
 *
 *   npx tsx scripts/set-test-prices.ts            # dry run
 *   npx tsx scripts/set-test-prices.ts --write
 */
import { toHex } from "viem";
import { packetToBytes } from "viem/ens";
import { RESOLVER_ABI, resolveMerchant, sepoliaClient } from "@sangam/ens";
import { sangamWallet } from "../packages/ens/src/wallet.ts";

const PRICES_INR: Record<string, number> = {
  "tickets.sangam.eth": 5,
  "bakery.sangam.eth": 5,
  "sangam-demo.sangam.eth": 1,
  "test-shop.sangam.eth": 2,
  "chocolate-truffle-cake.bakery.sangam.eth": 3,
  "butter-croissant.bakery.sangam.eth": 1,
  "sourdough-loaf.bakery.sangam.eth": 2,
};

const client = sepoliaClient();
const shared = (process.env.ENS_SANGAM_RESOLVER ?? "").toLowerCase();
const calls: `0x${string}`[] = [];
for (const [name, inr] of Object.entries(PRICES_INR)) {
  const resolver = (await client.getEnsResolver({ name }).catch(() => null))?.toLowerCase();
  const before = await resolveMerchant(name).then((r) => r.priceInrPaise / 100).catch(() => null);
  if (resolver !== shared) {
    console.log(`skip ${name}: resolver ${resolver} isn't Sangam's (the merchant owns it)`);
    continue;
  }
  console.log(`${name}: ₹${before} → ₹${inr}`);
  const { encodeFunctionData } = await import("viem");
  calls.push(encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [toHex(packetToBytes(name)), "sangam.priceInrPaise", String(inr * 100)] }));
}
if (!process.argv.includes("--write")) {
  console.log(`dry run: ${calls.length} prices to write (add --write)`);
  process.exit(0);
}
const wallet = sangamWallet();
const tx = await wallet.writeContract({ address: shared as `0x${string}`, abi: RESOLVER_ABI, functionName: "multicall", args: [calls] });
const r = await client.waitForTransactionReceipt({ hash: tx });
console.log(`${r.status}: https://sepolia.etherscan.io/tx/${tx}`);
