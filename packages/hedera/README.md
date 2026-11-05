# @sangam/hedera

**Prize tracks:** Hedera "AI Agents That Pay: x402 on Hedera" and Hedera "No Solidity Allowed".
No smart contracts anywhere: payments are HTS (USDC) transfers and receipts are HCS messages.

| File | What it does | Hedera service / SDK |
|---|---|---|
| `src/x402.ts` | `createMerchantServer()`: the merchant side of x402 (402 invoice, verify + settle through the Blocky402 facilitator). `createPayingFetch()`: the buyer agent side (reads the 402, signs USDC, retries). | `@x402/core`, `@x402/hedera`, `@x402/fetch` |
| `src/mirror.ts` | `confirmPayment()`: checks on the Mirror Node that the USDC really reached the treasury, for at least the claimed amount, before Sangam pays anyone out. | Mirror Node REST API |
| `src/hcs.ts` | `writeReceipt()` posts every settlement to an HCS topic; `createTopic()` makes the topic (operator-only submit key). | HCS, `@hiero-ledger/sdk` |
| `src/hts.ts` | USDC balance and token association. | HTS |
| `src/client.ts` | Network id, USDC token id, operator client. | |
| `src/hashscan.ts` | HashScan links for transactions, topics and accounts. | |

Used by `apps/web/app/merchant/book` (paywall), `apps/web/app/api/pay` (agent), and `apps/web/lib/server/pipeline.ts` (verify + receipt).

## Proof (testnet)

First end-to-end agent payment, 1 Nov 2026: the agent (`0.0.6886822`) found `tickets.sangam.eth` on ENS, got a 402, signed 0.515518 USDC with no approval step, the Blocky402 facilitator (`0.0.7162784`) submitted it, and Sangam verified it on the Mirror Node before settling.

| What | Link |
|---|---|
| Settled x402 payment (USDC 0.0.429274, customer → treasury) | [0.0.7162784@1793527403.177518448](https://hashscan.io/testnet/transaction/0.0.7162784%401793527403.177518448) |
| HCS receipt topic | [0.0.11264249](https://hashscan.io/testnet/topic/0.0.11264249) (message #1 is the receipt for this payment) |
| Treasury | [0.0.11227656](https://hashscan.io/testnet/account/0.0.11227656) |
