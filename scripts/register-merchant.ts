// Publish a merchant's Sangam text records on an ENS name you control (Sepolia, ENSv2).
// Create the name/subname first in the ENS app; this script only writes records.
//   npm run register-merchant -- --name tickets.sangam.eth --url https://…/book \
//     --payTo 0.0.123 --price 4900 --upi tickets@razorpay
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { namehash, normalize } from "viem/ens";
import { MERCHANT_TEXT_KEYS, env, envOr } from "@sangam/shared";

const { values: a } = parseArgs({
  options: {
    name: { type: "string" },
    url: { type: "string" },
    payTo: { type: "string" },
    price: { type: "string" },
    upi: { type: "string" },
    network: { type: "string", default: "hedera:testnet" },
  },
});
for (const k of ["name", "url", "payTo", "price", "upi"] as const) {
  if (!a[k]) throw new Error(`missing --${k}`);
}

const name = normalize(a.name!);
const records: Record<string, string> = {
  [MERCHANT_TEXT_KEYS.endpoint]: a.url!,
  [MERCHANT_TEXT_KEYS.hederaPayTo]: a.payTo!,
  [MERCHANT_TEXT_KEYS.network]: a.network!,
  [MERCHANT_TEXT_KEYS.priceInrPaise]: a.price!,
  [MERCHANT_TEXT_KEYS.upiHandle]: a.upi!,
};

const transport = http(envOr("SEPOLIA_RPC_URL", ""));
const publicClient = createPublicClient({ chain: sepolia, transport });
const ownerKey = env("ENS_OWNER_PRIVATE_KEY");
const account = privateKeyToAccount((ownerKey.startsWith("0x") ? ownerKey : `0x${ownerKey}`) as Hex);
const wallet = createWalletClient({ chain: sepolia, transport, account });

// Look the resolver up each time; ENSv2 docs say not to hard-code it.
const resolver = await publicClient.getEnsResolver({ name });
console.log(`${name} resolver: ${resolver}`);

const abi = parseAbi(["function setText(bytes32 node, string key, string value)"]);
const node = namehash(name);
for (const [key, value] of Object.entries(records)) {
  const hash = await wallet.writeContract({ address: resolver, abi, functionName: "setText", args: [node, key, value] });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ${key} = ${value}  (${hash})`);
}
console.log("done. Check with: ENS_OFFLINE=false npm run buy -- --merchant", name);
