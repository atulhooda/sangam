// Set up the Whitechain rail: compile, deploy and verify SangamReceipts on
// Whitechain Sepolia (chain 1874), then print the env lines to add.
//
//   npm run deploy-whitechain            deploy (needs WHITECHAIN_RELAYER_PRIVATE_KEY with WBT)
//   npm run deploy-whitechain -- --key   just make a relayer key and show what to fund
//   npm run deploy-whitechain -- --verify 0x…   re-run explorer verification only
import { readFileSync } from "node:fs";
import path from "node:path";
import solc from "solc";
import { formatEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { REPO_ROOT, hasEnv } from "@sangam/shared";
import {
  depositAddress,
  explorerAddressUrl,
  explorerTxUrl,
  relayerAccount,
  relayerWallet,
  usdtBalance,
  wbtBalance,
  whitechainExplorerUrl,
} from "@sangam/whitechain";

const SOURCE = "SangamReceipts.sol";
const COMPILER = "v0.8.26+commit.8a97fa7a";
const args = process.argv.slice(2);

if (args.includes("--key") || !hasEnv("WHITECHAIN_RELAYER_PRIVATE_KEY")) {
  const key = generatePrivateKey();
  console.log("No relayer yet. Add this to .env (and Railway):\n");
  console.log(`WHITECHAIN_RELAYER_PRIVATE_KEY=${key}`);
  console.log(`\nThen fund ${privateKeyToAccount(key).address} with WBT and USDT at https://faucet.testnet.whitechain.io`);
  console.log("and run npm run deploy-whitechain again.");
  process.exit(0);
}

const standardInput = {
  language: "Solidity",
  sources: { [SOURCE]: { content: readFileSync(path.join(REPO_ROOT, "contracts", SOURCE), "utf8") } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

/** Verify on the Whitechain explorer (Blockscout) from the same standard JSON input. */
async function verify(address: Hex) {
  const form = new FormData();
  form.set("compiler_version", COMPILER);
  form.set("contract_name", "SangamReceipts");
  form.set("autodetect_constructor_args", "true");
  form.set("license_type", "mit");
  form.set("files[0]", new Blob([JSON.stringify(standardInput)], { type: "application/json" }), "input.json");
  const url = `${whitechainExplorerUrl()}/api/v2/smart-contracts/${address}/verification/via/standard-input`;
  const res = await fetch(url, { method: "POST", body: form });
  console.log(`verification submitted: ${res.status} ${(await res.text()).slice(0, 200)}`);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3_000));
    const info = (await (await fetch(`${whitechainExplorerUrl()}/api/v2/smart-contracts/${address}`)).json().catch(() => ({}))) as { is_verified?: boolean };
    if (info.is_verified) return console.log(`verified ✓ ${explorerAddressUrl(address)}?tab=contract`);
  }
  console.log(`not verified yet; check ${explorerAddressUrl(address)}?tab=contract (re-run with --verify ${address})`);
}

const verifyOnly = args.indexOf("--verify");
if (verifyOnly >= 0) {
  await verify(args[verifyOnly + 1] as Hex);
  process.exit(0);
}

const relayer = relayerAccount().address;
const [wbt, usdt] = await Promise.all([wbtBalance(relayer), usdtBalance(relayer)]);
console.log(`relayer ${relayer}: ${formatEther(wbt)} WBT, ${Number(usdt) / 1e6} USDT`);
if (wbt === 0n) {
  console.log(`Fund it with WBT first: https://faucet.testnet.whitechain.io`);
  process.exit(1);
}

const out = JSON.parse(solc.compile(JSON.stringify(standardInput))) as {
  errors?: { severity: string; formattedMessage: string }[];
  contracts: Record<string, Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>>;
};
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
const compiled = out.contracts[SOURCE]!.SangamReceipts!;

const wallet = relayerWallet();
const hash = await wallet.deployContract({ abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}` as Hex });
console.log(`deploying… ${explorerTxUrl(hash)}`);
const receipt = await wallet.waitForTransactionReceipt({ hash });
const address = receipt.contractAddress;
if (receipt.status !== "success" || !address) throw new Error(`deploy failed: ${hash}`);
console.log(`SangamReceipts at ${address}`);

await verify(address);

console.log("\nAdd to .env and Railway:\n");
console.log(`WHITECHAIN_RECEIPTS_ADDRESS=${address}`);
console.log("\nDeposit addresses for the demo merchants (published to ENS by npm run whitechain-ens):");
for (const name of ["tickets.sangam.eth", "bakery.sangam.eth"]) console.log(`  ${name}  ${depositAddress(name)}`);
