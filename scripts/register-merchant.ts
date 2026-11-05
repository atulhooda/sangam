// Publish a merchant's Sangam text records on an ENS name you control (Sepolia, ENSv2).
// Create the name/subname first in the ENS app; this script only writes records.
//   npm run register-merchant -- --name tickets.sangam.eth --url https://…/merchant/book \
//     --payTo 0.0.123 --price 4900 --upi tickets@razorpay
import { parseArgs } from "node:util";
import { publishMerchant } from "@sangam/ens";

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

console.log(`writing Sangam records on ${a.name}…`);
await publishMerchant(
  { ensName: a.name!, endpoint: a.url!, hederaPayTo: a.payTo!, network: a.network!, priceInrPaise: a.price!, upiHandle: a.upi! },
  (r) => console.log(`  ${r.key} = ${r.value}  (${r.txHash})`),
);
console.log("done. Set ENS_OFFLINE=false in .env to read the merchant from ENS.");
