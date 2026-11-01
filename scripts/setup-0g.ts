// One-off: fund the 0G ledger and the chosen provider so Sangam can run decisions on 0G Compute.
// Safe to re-run: it skips steps that are already done.
//   npm run setup-0g           # list providers
//   npm run setup-0g -- fund   # create ledger + acknowledge + fund OG_PROVIDER_ADDRESS
import { ethers } from "ethers";
import { fundProvider, getBroker } from "@sangam/og";
import { env, envOr } from "@sangam/shared";

const broker = await getBroker();
const wallet = new ethers.Wallet(env("OG_PRIVATE_KEY"), new ethers.JsonRpcProvider(envOr("OG_RPC_URL", "https://evmrpc-testnet.0g.ai")));
console.log(`wallet ${wallet.address}: ${ethers.formatEther(await wallet.provider!.getBalance(wallet.address))} OG`);

if (process.argv[2] !== "fund") {
  console.log("\nproviders:");
  for (const s of await broker.inference.listService()) console.log(`  ${s.provider}  ${s.model}`);
  console.log("\nSet OG_PROVIDER_ADDRESS in .env, then run: npm run setup-0g -- fund");
  process.exit(0);
}

await fundProvider(env("OG_PROVIDER_ADDRESS"), envOr("OG_LEDGER_DEPOSIT", "0.4"), envOr("OG_PROVIDER_FUND", "0.1"), (m) => console.log(m));
