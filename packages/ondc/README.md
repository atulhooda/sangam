# @sangam/ondc

**Sangam as an ONDC buyer app (BAP).** An AI agent can't speak ONDC, and an ONDC seller can't take USDC. Sangam sits between them: the agent pays USDC over x402 on Hedera, Sangam places the order on ONDC and settles the seller in rupees (ONDC's "buyer app collects payment" model). Each seller gets an ENS name, `ondc-<seller>.sangam.eth`, issued by Sangam on its first order.

```
agent ──GET catalog?q=atta──▶ Sangam ──signed search──▶ seller app ──signed on_search──▶ Sangam
agent ──GET order (unpaid)──▶ Sangam ──select──▶ seller ──on_select (quote ₹460)──▶ 402: 4.84 USDC
agent ──signed USDC (x402)──▶ Sangam ──init──▶ seller ──on_init (seller UPI)──▶ facilitator settles USDC
                              Sangam ──confirm (PAID)──▶ seller ──on_confirm (Accepted)──▶ order to agent
                              Sangam: verify on Mirror Node → decide → UPI payout to seller → HCS receipt
```

The order is confirmed with the seller **only after the USDC has settled**, and a payment whose order the seller didn't accept is held, never paid out.

## Files

| File | What it does |
|---|---|
| `src/signing.ts` | ONDC request signing: Ed25519 over a BLAKE2b-512 body digest, in ONDC's `Authorization: Signature keyId="<subscriber>\|<key>\|ed25519",…` format, plus verification. |
| `src/registry.ts` | Local stand-in for the ONDC registry (subscriber id, key id, signing public key). Keys are generated on first use; private keys stay in git-ignored `data/ondc-keys.local.json`. |
| `src/protocol.ts` | ONDC Retail B2B 2.0.2 (`ONDC:RET10`) context and message shapes, signed POST. |
| `src/client.ts` | The BAP: `search`, `select`, `init`, `confirm`. Each POSTs the action, takes the ACK, and waits for the matching signed `on_<action>` callback (by `message_id`). |
| `src/seller-mock.ts` | **Mock seller app (BPP)**, see below. |
| `src/merchant.ts` | `ondcLabel()`: the seller's ENS label. |

Routes in `apps/web`: `/merchant/ondc/catalog` (free search), `/merchant/ondc/order` (x402-paid order), `/ondc/on_*` (Sangam's callbacks, signature-checked), `/ondc-seller/*` (the mock seller).

## About the seller

**The seller is a mock.** ONDC's hosted mock (`mock.ondc.org`) and staging registry were unreachable (HTTP 502) when this was built, and real staging needs registration. `seller-mock.ts` plays a Retail B2B seller ("Annapurna Wholesale, Pune", made-up catalog and UPI handle) and behaves like a real seller app: it verifies Sangam's signature, ACKs, and replies with signed `on_*` messages to the `bap_uri`, including UPI settlement details in `on_init`. Sangam reaches it only over signed ONDC messages, so pointing at a real seller app is a registry and URL change, not a code change.

## Proof (1 Nov 2026)

`npm run buy-ondc -- atta 1`: the agent found "Chakki atta, 10 kg" (₹420 + ₹40 delivery) and paid 4.839555 USDC with no approval step. ONDC order `ANP-E64E739A` was Accepted; Sangam verified the payment, paid the seller ₹457.70 (50 bps fee) to `annapurna.wholesale@okaxis` (mock UPI), issued `ondc-annapurna-wholesale.sangam.eth` on ENS and wrote HCS receipt #2.

| What | Link |
|---|---|
| USDC payment | [0.0.7162784@1793550918.578268734](https://hashscan.io/testnet/transaction/0.0.7162784%401793550918.578268734) |
| HCS receipt #2 | [topic 0.0.11264249](https://hashscan.io/testnet/topic/0.0.11264249) |
| Seller's ENS name | [ondc-annapurna-wholesale.sangam.eth](https://sepolia.app.ens.domains/ondc-annapurna-wholesale.sangam.eth) |
