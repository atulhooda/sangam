# @sangam/ens

**Prize track:** ENS "Best Use of ENSv2".

**Sangam is a merchant registry built on ENSv2.** Every merchant Sangam settles for gets a subname under `sangam.eth` (`tickets.sangam.eth`, `ondc-<seller>.sangam.eth`, …), issued by Sangam. The merchant never needs a wallet, ETH or an ENS name of its own. An agent knows a merchant only by that name; the paywalled URL, the Hedera account to pay, the network, the INR price and the UPI handle all come from the name's text records.

## How it uses ENSv2 (Sepolia)

| ENSv2 piece | How Sangam uses it |
|---|---|
| **UserRegistry** (via VerifiableFactory) | Sangam's own registry for `sangam.eth`, attached with `setSubregistry`. Each merchant is an ERC-1155 subname token in it. |
| **PermissionedResolver** (via VerifiableFactory) | One resolver holds every merchant's records. Sangam holds the setter roles; all five records are written in one `multicall`. |
| **Role bitmaps** | Merchant tokens carry `ROLE_SET_RESOLVER`, `ROLE_RENEW` and `ROLE_CAN_TRANSFER_ADMIN`, so Sangam can hand a name to a merchant later. |
| **Universal Resolver** | Agents read records with plain viem `getEnsText`; nothing Sangam-specific is needed to resolve a merchant. |

## Files

| File | What it does |
|---|---|
| `src/records.ts` | The text-record keys: `url`, `sangam.payTo`, `sangam.network`, `sangam.priceInrPaise`, `sangam.upi`. |
| `src/contracts.ts` | ENSv2 Sepolia addresses, ABIs and role constants (from `ensdomains/contracts-v2`). |
| `src/setup.ts` | `setupSangamRegistry()`: deploys the resolver and registry and attaches them to `sangam.eth`. Run once: `npm run setup-ens`. |
| `src/subnames.ts` | `issueSubname(label, merchant)`: registers `<label>.sangam.eth` (if new) and writes its records. Idempotent. `npm run add-merchant`. |
| `src/resolve.ts` | `resolveMerchant(name)`: reads the records on Sepolia (`ENS_OFFLINE=true` reads `data/merchants.local.json`). |
| `src/client.ts`, `src/wallet.ts` | Sepolia read client and Sangam's signing wallet. |

## Setup

1. Put a Sepolia-funded key in `ENS_OWNER_PRIVATE_KEY` and register `sangam.eth` with that wallet at sepolia.app.ens.domains.
2. `npm run setup-ens`, then paste `ENS_SANGAM_REGISTRY` / `ENS_SANGAM_RESOLVER` into `.env`.
3. `npm run add-merchant -- --label tickets --url https://…/merchant/book --payTo 0.0.x --price 4900 --upi tickets@razorpay`
4. Set `ENS_OFFLINE=false`.

## Proof (Sepolia)

| What | Link |
|---|---|
| `sangam.eth` registration | [0xb062ef3b…](https://sepolia.etherscan.io/tx/0xb062ef3ba8175ba2b89633f99b58d24bedd4375384af791e37e5ac17de792af2) |
| Sangam's UserRegistry | [0x0AD69c22…9D04](https://sepolia.etherscan.io/address/0x0AD69c220f08aa7951130A2813b4d528caba9D04) |
| Sangam's PermissionedResolver | [0x524EA9C9…FE84](https://sepolia.etherscan.io/address/0x524EA9C91Ab70FC4D28DB2C34A42Ff2511C0FE84) |
| `tickets.sangam.eth` issued | [0x0274dbc0…](https://sepolia.etherscan.io/tx/0x0274dbc04e0eb3f4429fb8449aa32256a9684a00af2070730fc84b660bc97edf) |
| `tickets.sangam.eth` records (one multicall) | [0x744760d0…](https://sepolia.etherscan.io/tx/0x744760d095d8670ac3e51e56f62c102fee13f283e3f822e68f08584138905e61) |
| View the name | [sepolia.app.ens.domains/tickets.sangam.eth](https://sepolia.app.ens.domains/tickets.sangam.eth) |
