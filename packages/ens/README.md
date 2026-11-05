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

**Proof:** registry: _TBD_ · resolver: _TBD_ · `tickets.sangam.eth`: _TBD_
