// Publish each merchant's Whitechain deposit address in its ENS name
// (sangam.payTo.whitechain), so verified-only agents can pay it in USDT on
// Whitechain. New merchants get it at onboarding; this backfills existing ones.
//
//   npm run whitechain-ens                      tickets + bakery
//   npm run whitechain-ens -- riya.sangam.eth   specific names
import { forgetMerchant, issueSubname, parentName, resolveMerchant } from "@sangam/ens";
import { envOr } from "@sangam/shared";
import { depositAddress, explorerAddressUrl } from "@sangam/whitechain";

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [envOr("MERCHANT_ENS_NAME", "tickets.sangam.eth"), envOr("BAKERY_ENS_NAME", `bakery.${parentName()}`)];

for (const name of names) {
  const address = depositAddress(name);
  const record = await resolveMerchant(name);
  if (record.whitechainPayTo?.toLowerCase() === address.toLowerCase()) {
    console.log(`${name}: already publishes ${address}`);
    continue;
  }
  const label = name.slice(0, -`.${parentName()}`.length);
  // Rewrites the five records as they are and adds the Whitechain one; sangam.status is left untouched.
  const { endpoint, hederaPayTo, network, upiHandle, priceInrPaise } = record;
  const issued = await issueSubname(label, { endpoint, hederaPayTo, network, upiHandle, priceInrPaise, whitechainPayTo: address }, (m) => console.log(`  ${m}`));
  forgetMerchant(name);
  console.log(`${name}: sangam.payTo.whitechain = ${address}  ${explorerAddressUrl(address)}`);
  for (const t of issued.txs) console.log(`  ${t.step}: https://sepolia.etherscan.io/tx/${t.tx}`);
}
