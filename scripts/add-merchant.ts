// Onboard a merchant: Sangam issues <label>.sangam.eth and writes its records.
// The merchant needs no wallet or ENS name. Safe to re-run (updates records).
//   npm run add-merchant -- --label tickets --url https://…/merchant/book \
//     --payTo 0.0.123 --price 4900 --upi tickets@razorpay [--status verified|suspended]
// Merchants who sign up on the site are provisioned by Sangam itself; this
// script is for Sangam's own names (the demo shop, the ONDC gateway).
import { parseArgs } from "node:util";
import { issueSubname } from "@sangam/ens";

const { values: a } = parseArgs({
  options: {
    label: { type: "string" },
    url: { type: "string" },
    payTo: { type: "string" },
    price: { type: "string" },
    upi: { type: "string" },
    network: { type: "string", default: "hedera:testnet" },
    status: { type: "string" },
  },
});
for (const k of ["label", "url", "payTo", "price", "upi"] as const) {
  if (!a[k]) throw new Error(`missing --${k}`);
}
if (a.status && a.status !== "verified" && a.status !== "suspended") throw new Error("--status must be verified or suspended");

const issued = await issueSubname(
  a.label!,
  {
    endpoint: a.url!,
    hederaPayTo: a.payTo!,
    network: a.network!,
    priceInrPaise: a.price!,
    upiHandle: a.upi!,
    ...(a.status ? { status: a.status as "verified" | "suspended" } : {}),
  },
  (m) => console.log(m),
);
for (const t of issued.txs) console.log(`  ${t.step}: https://sepolia.etherscan.io/tx/${t.tx}`);
console.log(`${issued.registered ? "issued" : "updated"} ${issued.name}${issued.offline ? " (offline file)" : ""}`);
