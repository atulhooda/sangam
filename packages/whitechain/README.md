# @sangam/whitechain

Sangam's second payment rail: USDT on **Whitechain Sepolia** (chain 1874), next to USDC on Hedera.
Every merchant invoice offers both; the buyer's agent pays on either, and the same pipeline
(ENS checks → on-chain verification → 0G decision → UPI payout → receipt → refund) runs after.

| Step | Hedera (`@sangam/hedera`) | Whitechain (this package) |
|---|---|---|
| Pay | x402 + USDC via Blocky402 | x402 + USDT (EIP-3009) via **Sangam's own facilitator** (`x402.ts`) |
| Receive | Hedera deposit account per merchant | Derived EVM deposit address per merchant (`keys.ts`), no tx needed |
| Verify | Mirror Node | Tx receipt's USDT `Transfer` logs (`verify.ts`) |
| Receipt | HCS topic, hash-chained | `SangamReceipts` contract, hash-chained on chain (`receipts.ts`, `contracts/SangamReceipts.sol`) |
| Refund | Scheduled transaction | Gasless USDT transfer signed by the deposit address, submitted by the relayer (`tokens.ts`) |

## Who pays gas

Nobody but Sangam's **relayer** holds WBT. Buyers sign an EIP-3009 `transferWithAuthorization`
(Whitechain's test USDT supports it: domain `Tether USD` / `1`), the facilitator verifies it with
an `eth_call` and submits it from the relayer. Refunds work the same way in reverse: the merchant's
deposit address signs, the relayer submits.

What stops someone draining the relayer (checked before verify and again before settle):

1. only Whitechain USDT, only EIP-3009 (no Permit2 approvals to sponsor);
2. only into a Sangam merchant's deposit address (allowlist);
3. at most `WHITECHAIN_MAX_PER_PAYMENT` per payment;
4. at most 6 settlements per payer per minute;
5. never below `WHITECHAIN_MIN_RELAYER_WBT` of gas in reserve.

A rejected attempt costs nothing on chain: verification is an `eth_call`.

## Setup

```bash
npm run deploy-whitechain -- --key     # makes WHITECHAIN_RELAYER_PRIVATE_KEY; fund it at faucet.testnet.whitechain.io
npm run deploy-whitechain              # deploys + verifies SangamReceipts, prints WHITECHAIN_RECEIPTS_ADDRESS
npm run whitechain-ens                 # publishes sangam.payTo.whitechain on the demo merchants' ENS names
```

## For merchants on other servers

Sangam's facilitator is served over HTTP in the standard x402 shape:

```ts
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const server = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: "https://<sangam-host>/api/facilitator/whitechain" }),
).register("eip155:1874", new ExactEvmScheme());
// price: { asset: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", amount: "500000", extra: { name: "Tether USD", version: "1" } }
// payTo: your sangam.payTo.whitechain address
```
