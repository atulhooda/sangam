# Sangam: Build Plan

ETHGlobal Mumbai, solo build. This is the spec to follow at the event. **No project code is written before kickoff**: the main track is "From Scratch", and anything built earlier loses partner-prize and Finalist eligibility.

> Commit this file to the repo on day 1 as `docs/SPEC.md`. ETHGlobal allows AI tools if you attribute them and include spec files and prompts, and this is the spec.

---

## 0. Corrections to the earlier chat plan

Checking the real SDK docs changed four things:

| Earlier plan | Now | Why |
|---|---|---|
| Solidity escrow contract on Hedera | **No contract in the MVP.** x402 pays straight into a Sangam treasury account. The escrow contract is a stretch goal. | x402 on Hedera settles a plain `TransferTransaction` to `payTo`. A contract adds HTS-via-EVM token association work and no extra demo value. |
| "One real ₹1 UPI payout" | **Payout through a PSP sandbox (Razorpay/Cashfree test mode)**, clearly labelled as sandbox. | Sending real UPI money from code needs a business payouts account with KYC. Sending ₹1 by hand and calling it automated would be faking the demo. |
| 0G "Build with iAI" as a sure thing | **Ask at the 0G booth in the first hour** whether broker-funded 0G Compute counts, or only staked-iAI credits. Fallback: 0G Wildcard ($2K). | The prize requires spending *staked iAI daily credits*. The public SDK uses an OG-token ledger. They may not be the same thing. |
| World ID for merchant identity | **ENSv2 on Sepolia** (live there now) | World's prize details aren't published. ENS gives the project a real job (see §3). |

**Check the dates in your hacker dashboard.** The event is listed as Nov 6–8, but the details page gave the submission deadline as **Sat Nov 7, 09:00 IST**. Those don't fit together. The timeline in §8 counts hours from kickoff (H+0) so it works either way, but find out which is right.

---

## 1. What Sangam does

An AI agent anywhere in the world pays an Indian merchant's API in USDC over x402 on Hedera. Sangam's settlement agent checks the payment, decides how to settle it (0G Compute inference), pays the merchant in INR over UPI (sandbox), and writes a receipt to a Hedera Consensus Service (HCS) topic. Merchants are found by ENS name.

```
customer-agent                merchant-api (x402 paywall)          settlement-agent
──────────────                ───────────────────────────          ────────────────
1. resolve tickets.sangam.eth
   → endpoint URL, price, payTo
2. GET /book ───────────────► 402 Payment Required
3. sign USDC transfer ───────► facilitator /verify + /settle
                               (USDC lands in Sangam treasury)
                              4. return ticket JSON ◄── buyer gets the goods
                              5. POST /settlements {txId} ───────► 6. confirm tx on Mirror Node
                                                                    7. 0G inference: settlement decision
                                                                    8. INR payout via PSP sandbox
                                                                    9. HCS receipt message
                                                     dashboard ◄─── 10. GET /settlements
```

---

## 2. Prize targets and the proof each one needs

Pick these three on the final submission step.

### Hedera: AI Agents That Pay: x402 ($6.5K: 3K/2K/1.5K)
- [ ] At least one x402-protected endpoint settling on `hedera:testnet` through a documented facilitator
- [ ] customer-agent completes a paid request **end to end with no human approval**
- [ ] README: setup, architecture, payment flow, **one settled tx ID** (HashScan link)
- [ ] Demo video ≤5 min showing a payment settle, linked on HashScan
- Bonus points this build already covers: spend controls (customer-agent `spendControls`), HCS topic as a tamper-evident audit log, Mirror Node use

### 0G: Build with iAI ($5K), or Wildcard ($2K) as fallback
- [ ] Inference on 0G Compute inside the settlement loop, with a **request/chat ID logged per settlement**
- [ ] Credits visibly spent (show ledger balance before and after in the dashboard)
- [ ] README answers "why come back tomorrow": every settlement needs a decision, every decision costs credits
- [ ] Avoid their stated rejection, "generic chat wrapper": the model makes a structured decision, not chat
- [ ] Submit: repo, video under 3 min (their limit is stricter, so make the main video ≤3 min), live demo link, contract/account addresses

### ENS: Best Use of ENSv2 ($7K: 3K/2K/1K×2)
- [ ] Each merchant is a subname (`tickets.sangam.eth`) on **ENSv2 Sepolia**
- [ ] customer-agent finds merchants **only** through ENS. No hard-coded URLs or account IDs (they explicitly reject hard-coded values)
- [ ] Use at least one ENSv2-specific feature as part of how it works: Enhanced Access Control so a merchant can edit only its own `sangam.*` records, not the subname itself
- [ ] Live demo link, open-source repo

---

## 3. Stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere, Node 20+, pnpm workspaces |
| HTTP server | Express |
| x402 server | `@x402/express`, `@x402/core`, `@x402/hedera` (`ExactHederaScheme` from `@x402/hedera/exact/server`) |
| x402 client | `@x402/fetch`, `@x402/core/client`, `@x402/hedera` (`createClientHederaSigner`, `ExactHederaScheme` from `@x402/hedera/exact/client`) |
| Facilitator | Primary: Blocky402 testnet `https://api.testnet.blocky402.com`. Backups: `https://x402.org/facilitator`, `https://testnet.facilitator.ax402.io` |
| Hedera SDK | `@hiero-ledger/sdk` (HCS topic + messages, token association) |
| Hedera reads | Mirror Node REST `https://testnet.mirrornode.hedera.com/api/v1/...` |
| 0G Compute | `@0glabs/0g-serving-broker` (README pins 0.6.2; check npm for latest) + `ethers@6` + `openai@4` |
| ENS | `viem` against ENSv2 Sepolia deployments (addresses: docs.ens.domains/learn/deployments#sepolia-ensv2) |
| Storage | One JSON file (`data/settlements.json`) behind a small module. No database. |
| Dashboard | Vite + vanilla TS, one page |
| Hosting | Your laptop for the live demo. Render/Railway free tier for the "live demo link" |

---

## 4. Do these before kickoff (setup only, no code)

None of this is project code, so it doesn't break From Scratch.

- [ ] **Hedera testnet**: create 3 ECDSA accounts at portal.hedera.com: `treasury` (Sangam's payTo), `customer` (buyer agent), `operator` (HCS + admin). Fund them with faucet HBAR.
- [ ] **Testnet USDC on Hedera**: find the token ID (believed to be `0.0.429274`; **check on HashScan**), associate it to `treasury` and `customer`, and fund `customer` from faucet.circle.com.
- [ ] **0G testnet**: wallet with ≥5 OG from faucet.0g.ai (ledger needs ≥3 OG, each provider needs ≥1 OG). RPC `https://evmrpc-testnet.0g.ai`, chain 16602.
- [ ] **Sepolia ETH** for ENS (any Sepolia faucet). Read docs.ens.domains/ensv2/overview and /ensv2/tutorial-app-developers.
- [ ] **PSP sandbox**: sign up for Razorpay or Cashfree test mode now. Account approval can take days, and you want test API keys in hand by Nov 6.
- [ ] **Read once, run nothing**: Blocky402 quickstart + testnet guide, Hedera x402 merchant guide, the x402 seller and buyer quickstarts, the 0G TS starter kit README.
- [ ] Install Node 20, pnpm, and Docker (only needed if you self-host Blocky402).

---

## 5. Repo layout

```
sangam/
├── package.json                 # pnpm workspaces
├── .env.example                 # every variable from §7, no values
├── README.md
├── FEEDBACK.md                  # optional; only needed if you add Uniswap
├── docs/
│   ├── SPEC.md                  # this file
│   └── architecture.png
├── packages/
│   └── shared/                  # types + config loader used by every app
│       └── src/{types.ts, config.ts, ens.ts}
├── apps/
│   ├── merchant-api/            # x402 paywalled "Indian merchant"   :3000
│   ├── settlement-agent/        # verify → decide → pay out → receipt :3001
│   ├── customer-agent/          # autonomous buyer script (CLI)
│   └── dashboard/               # static page (Vite)                  :5173
└── scripts/
    ├── create-hcs-topic.ts      # one-off: prints HCS_TOPIC_ID
    └── register-merchant.ts     # one-off: creates ENS subname + records
```

---

## 6. Interfaces

### 6.1 Shared types (`packages/shared/src/types.ts`)

```ts
type MerchantRecord = {
  ensName: string;          // "tickets.sangam.eth"
  endpoint: string;         // "https://.../book"
  hederaPayTo: string;      // Sangam treasury, "0.0.x"
  upiHandle: string;        // sandbox VPA, e.g. "merchant@razorpay"
  priceInrPaise: number;    // 4900 = ₹49
};

type Settlement = {
  id: string;
  merchant: string;         // ens name
  hederaTxId: string;       // from x402 settle response
  usdcAmount: string;       // smallest units, 6 decimals
  inrPaise: number;
  fxRate: number;           // INR per USDC used
  decision: "payout" | "hold";
  decisionReason: string;
  ogChatId: string;         // 0G Compute chat/request ID (proof for 0G)
  payoutRef: string | null; // PSP sandbox payout ID
  hcsSequence: number | null;
  status: "received" | "decided" | "paid" | "held" | "failed";
  createdAt: string;
};
```

### 6.2 ENS text records per merchant

Keys on `<merchant>.sangam.eth`:

| Key | Example |
|---|---|
| `url` | `https://sangam-merchant.onrender.com/book` |
| `sangam.payTo` | `0.0.7xxxxxx` |
| `sangam.network` | `hedera:testnet` |
| `sangam.priceInrPaise` | `4900` |
| `sangam.upi` | `tickets@razorpay` (sandbox) |

`packages/shared/src/ens.ts` exposes `resolveMerchant(name): Promise<MerchantRecord>`. customer-agent and settlement-agent both use it. Nothing else knows a URL or account ID.

### 6.3 merchant-api (`:3000`)

| Route | Paywalled | Does |
|---|---|---|
| `GET /book?from=CSMT&to=PUNE&date=2026-11-08` | yes, x402 | Returns a fake ticket JSON (PNR, train, seat) |
| `GET /health` | no | `{ ok: true }` |

- x402 config: route `"GET /book"` with `accepts: [{ scheme: "exact", network: "hedera:testnet", price, payTo }]`. Register `ExactHederaScheme` on `"hedera:*"` with the testnet USDC token ID and 6 decimals under `defaultAssets`.
- Price = `priceInrPaise` converted to USDC at the current FX rate (refresh every 60s from any free FX API, cached).
- After a successful settle, read the tx ID from the payment response header and `POST` it to settlement-agent `/settlements`. Fire-and-forget: the buyer gets the ticket either way.

### 6.4 settlement-agent (`:3001`)

| Route | Does |
|---|---|
| `POST /settlements` `{ merchant, hederaTxId }` | Runs the pipeline below; returns the `Settlement` |
| `GET /settlements` | List, newest first (dashboard reads this) |
| `GET /stats` | Totals + 0G ledger balance |

Pipeline, one function per step, each step updates `status`:
1. **Confirm**: fetch the tx from Mirror Node. Check it succeeded, credited `treasury` with USDC, and the amount matches the quote. Reject replays (same tx ID seen before).
2. **Decide (0G)**: one inference call. The prompt contains the amount, merchant, FX rate, and the merchant's last N settlements. The model must return JSON `{ decision, reason, feeBps }`. Validate with a schema. If parsing fails, use `hold`. Store `ogChatId`, then call `processResponse` to verify.
3. **Payout**: if `payout`, call the PSP sandbox payout API to `upiHandle` for `inrPaise − fee` and store `payoutRef`.
4. **Receipt**: send an HCS `TopicMessageSubmitTransaction` with `{ id, hederaTxId, inrPaise, decision, ogChatId, payoutRef }` and store the sequence number.

0G notes: build the broker once at startup. Call `acknowledgeProviderSigner` + `transferFund` once (guard so it's idempotent). Generate request headers fresh for every request; they are single-use.

### 6.5 customer-agent (CLI)

```
pnpm --filter customer-agent start -- --merchant tickets.sangam.eth --count 3
```
1. `resolveMerchant()` → endpoint
2. Fetch wrapped with x402 (Hedera signer, `hedera:testnet`)
3. Spend controls on: `maxAmountPerPayment: "$1"`, plus a session budget it enforces itself
4. Print each ticket and settled tx ID with a HashScan link
No prompts and no confirmations. This is the "no human approval" proof.

### 6.6 dashboard (`:5173`)

One page that polls `/settlements` every 2s. Header: Sangam + tagline. Cards: total USDC in, total ₹ paid out, 0G credits spent. Table: time · merchant · USDC · ₹ · decision + reason · HashScan link · 0G chat ID · payout ref · HCS seq. This page is the backdrop of the video.

---

## 7. Environment variables (`.env.example`)

```
# Hedera
HEDERA_NETWORK=hedera:testnet
HEDERA_USDC_TOKEN_ID=            # check on HashScan
TREASURY_ACCOUNT_ID=
TREASURY_PRIVATE_KEY=
CUSTOMER_ACCOUNT_ID=
CUSTOMER_PRIVATE_KEY=
OPERATOR_ACCOUNT_ID=
OPERATOR_PRIVATE_KEY=
HCS_TOPIC_ID=
MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com
FACILITATOR_URL=https://api.testnet.blocky402.com

# 0G
OG_RPC_URL=https://evmrpc-testnet.0g.ai
OG_PRIVATE_KEY=
OG_PROVIDER_ADDRESS=             # pick from the live service list on the day

# ENS (Sepolia, ENSv2)
SEPOLIA_RPC_URL=
ENS_OWNER_PRIVATE_KEY=
ENS_PARENT_NAME=sangam.eth

# PSP sandbox
PSP_KEY_ID=
PSP_KEY_SECRET=

# Services
MERCHANT_API_PORT=3000
SETTLEMENT_AGENT_URL=http://localhost:3001
```

Keys only in `.env` (gitignored), with three throwaway wallets. Never put keys in a commit: the repo is public and judges read it.

---

## 8. Timeline (hours from kickoff)

Commit at least every hour with real messages. Thin commit history can get a project disqualified.

| Hours | Goal | Done when |
|---|---|---|
| H+0–1 | Booths: 0G (ask the iAI-credit question), Hedera (confirm USDC token + facilitator), ENS (ENSv2 Sepolia help). Scaffold repo, commit SPEC.md. | Questions answered, repo pushed |
| H+1–4 | **Spike x402**: merchant-api `/book` behind a paywall, customer-agent pays it | 1 settled tx on HashScan |
| H+4–7 | **Spike 0G**: one inference call from settlement-agent with a chat ID logged | JSON decision printed |
| H+7–9 | **Spike ENS**: register `tickets.sangam.eth` with text records; `resolveMerchant()` works | customer-agent finds the endpoint via ENS |
| H+9–14 | settlement-agent pipeline steps 1–2 (confirm + decide) + JSON store | `/settlements` shows `decided` |
| H+14–17 | HCS receipts + PSP sandbox payout | status `paid` with payoutRef + HCS seq |
| H+17–20 | **Sleep.** Non-negotiable when solo. | |
| H+20–24 | Dashboard | Video backdrop looks right |
| H+24–27 | Deploy merchant-api + settlement-agent; ENS records point at the deployed URL | Live demo link works from your phone |
| H+27–30 | Hardening: replay check, `hold` path, error states shown in the dashboard | Run 10 payments in a row with no crash |
| H+30–33 | README + architecture diagram + record the video | Video ≤3 min, voiceover, 720p+ |
| H+33–35 | Submit; pick the 3 partner prizes | Submitted with ~1h spare |

**Cut order if behind** (cut from the top): dashboard polish → ENS Enhanced Access Control (keep plain subnames + records) → `hold` path → PSP sandbox (keep the "decided" status and show the payout as a clearly labelled mock). **Never cut:** a settled x402 tx, a 0G chat ID, ENS resolution. Those three are the prizes.

---

## 9. Demo script (≤3 min, voiceover, screen capture, no music)

1. **0:00** "Agents hold USDC. Indian merchants want rupees over UPI. They can't pay each other. Sangam is where they meet."
2. **0:15** Terminal: `customer-agent --merchant tickets.sangam.eth --count 3`. Show the ENS lookup, then the 402, then payment, then the ticket printed. No clicks.
3. **0:50** Click a HashScan link: the USDC transfer to treasury.
4. **1:10** Dashboard: three rows going `received → decided → paid`. Show the 0G decision reason and chat ID, and credits going down.
5. **1:50** PSP sandbox dashboard: the INR payout to the merchant VPA, labelled as sandbox.
6. **2:10** HCS topic on HashScan: receipts in order.
7. **2:30** "The agent never touched a bank. The merchant never touched crypto. Next: live PSP, refunds, more corridors."

---

## 10. Submission checklist

- [ ] Public repo, MIT license, readable commit history from kickoff onward
- [ ] README: problem, architecture diagram, setup steps, `.env.example`, one HashScan tx ID, HCS topic ID, ENS name, 0G provider address + a sample chat ID, sandbox disclosure for UPI, AI-tool attribution, link to `docs/SPEC.md`
- [ ] Video 2–3 min, 720p+, own voice (no TTS/AI voice), not sped up, not filmed on a phone
- [ ] Live demo link
- [ ] Partner prizes selected: Hedera x402, 0G (iAI or Wildcard), ENS ENSv2
- [ ] Submitted before the deadline. Late submissions are not accepted.

---

## 11. Questions to settle at the event

1. 0G: does broker-funded 0G Compute qualify for "Build with iAI", or only staked-iAI credits? How do hackers get the free credits?
2. Hedera: the official testnet USDC token ID, and whether the Blocky402 testnet facilitator supports HTS token payments (its docs example uses HBAR, `0.0.0`). If not, use the x402.org or Ax402 facilitator.
3. ENS: the recommended library and contract calls for ENSv2 subnames + Enhanced Access Control on Sepolia.
4. ETHGlobal: the exact hacking start and submission deadline (see §0).
