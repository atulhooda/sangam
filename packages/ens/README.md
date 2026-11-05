# @sangam/ens

**Prize track:** ENS "Best Use of ENSv2".

An agent knows a merchant only by its ENS name (e.g. `tickets.sangam.eth`). Everything else, the paywalled URL, the Hedera account to pay, the network, the INR price and the UPI handle, comes from the name's text records.

| File | What it does |
|---|---|
| `src/records.ts` | The text-record keys: `url`, `sangam.payTo`, `sangam.network`, `sangam.priceInrPaise`, `sangam.upi`. |
| `src/resolve.ts` | `resolveMerchant(name)`: reads the records on Sepolia with viem (`ENS_OFFLINE=true` reads `data/merchants.local.json`). |
| `src/publish.ts` | `publishMerchant()`: writes the records; used by `npm run register-merchant`. |

**Still to build:** ENSv2 subnames (Sangam issuing `<merchant>.sangam.eth` as a merchant registry), once the live ENSv2 testnet contracts are confirmed.

**Proof:** ENS name: _TBD_
