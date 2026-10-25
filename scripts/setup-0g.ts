// One-off: fund the 0G ledger and the chosen provider so settlement-agent can run inference.
// Safe to re-run: it skips steps that are already done.
//   npm run setup-0g           # list providers
//   npm run setup-0g -- fund   # create ledger + acknowledge + fund OG_PROVIDER_ADDRESS
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { ethers } from "ethers";
import { env, envOr } from "@sangam/shared";

// Testnet ledger contract (0xE708…E406) minimums: 0.1 OG to open, 0.01 OG per provider transfer.
const LEDGER_OG = Number(envOr("OG_LEDGER_DEPOSIT", "1"));
const PROVIDER_OG = envOr("OG_PROVIDER_FUND", "0.5");

const rpc = new ethers.JsonRpcProvider(envOr("OG_RPC_URL", "https://evmrpc-testnet.0g.ai"));
const wallet = new ethers.Wallet(env("OG_PRIVATE_KEY"), rpc);
const broker = await createZGComputeNetworkBroker(wallet);

console.log(`wallet ${wallet.address}: ${ethers.formatEther(await rpc.getBalance(wallet.address))} OG`);

const services = await broker.inference.listService();
console.log("\nproviders:");
for (const s of services) console.log(`  ${s.provider}  ${s.model}`);

if (process.argv[2] !== "fund") {
  console.log("\nSet OG_PROVIDER_ADDRESS in .env, then run: npm run setup-0g -- fund");
  process.exit(0);
}

const provider = env("OG_PROVIDER_ADDRESS");

try {
  const ledger = await broker.ledger.getLedger();
  console.log(`\nledger exists: ${ethers.formatEther(ledger.availableBalance)} OG available`);
} catch {
  console.log(`\ncreating ledger with ${LEDGER_OG} OG…`);
  await broker.ledger.addLedger(LEDGER_OG);
}

const status = await broker.inference.checkProviderSignerStatus(provider);
if (!status.isAcknowledged) {
  console.log("acknowledging provider…");
  await broker.inference.acknowledgeProviderSigner(provider);
}

console.log(`transferring ${PROVIDER_OG} OG to provider…`);
await broker.ledger.transferFund(provider, "inference", ethers.parseEther(PROVIDER_OG));
console.log("done.");
