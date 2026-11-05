# Sangam

Sangam is a settlement rail for the agent economy. An AI agent pays an Indian merchant's API over x402 in USDC on Hedera. Sangam checks the payment on-chain, decides how to settle it with 0G Compute, pays the merchant in INR over UPI, and writes a hash-chained receipt to a Hedera Consensus Service (HCS) topic. Agents find merchants by ENS name; merchants and users prove who they are with an Aadhaar QR (Self offchain SDK) — in zero knowledge.

```
1  customer-agent looks up tickets.sangam.eth on ENS → URL, price, payTo, UPI ID
2  customer-agent: GET /book         → merchant-api replies 402 + invoice
3  customer-agent signs a USDC transfer; the x402 facilitator submits it on Hedera
   merchant-api returns the ticket, then notifies the settlement pipeline
4  settlement: confirm the transfer on the Mirror Node
               decide with 0G Compute (pay out or hold, fee)
5              pay the merchant INR over UPI (RazorpayX test mode)
               — or, when held, schedule a USDC refund back to the payer
               write a hash-chained receipt to an HCS topic
   dashboard shows every step, and verifies the receipt chain from the Mirror Node
```

Everything runs in **one Next.js app** (`apps/web`): the merchant's x402 paywall, the settlement pipeline, the dashboard and the identity desk.

| URL | What it is |
|---|---|
| http://localhost:5173 | Home + links |
| http://localhost:5173/dashboard | The settlement desk: every payment, USDC in → rupees out |
| http://localhost:5173/merchant/&lt;ens-name&gt; | The merchant desk: one merchant's settlements, rupees earned, ENS records |
| http://localhost:5173/buyer | The buyer desk: the agent's purchases and budget left |
| http://localhost:5173/verify | The identity desk: merchants & users register with Aadhaar or passport (Self) |

People register once at `/verify` — a zero-knowledge proof from their Aadhaar (India) or passport (everyone else). The desks show the proof badge; until then they show a "register" banner. No login: the merchant's ENS name *is* the account, and the buyer's is their Hedera account.

## Quickstart (no keys, everything mocked)

**You need:** Node.js 22 and npm, on macOS, Linux or Windows.

```bash
# macOS: brew install node@22, then export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v                 # should print v22.x
cd sangam
npm install
npm run typecheck       # should print nothing and exit cleanly

cp .env.example .env    # Windows PowerShell: Copy-Item .env.example .env
npm run gen-keys        # prints SETTLEMENT_SHARED_SECRET and an EVM key
npm run dev             # http://localhost:5173
```

Open **http://localhost:5173/dashboard** and click **Simulate a payment**. Watch it move through the five steps. **Simulate an underpayment** shows the "held" path. Each mock is badged in yellow on the dashboard; turn them off one at a time in `.env`.

## Make a real payment (Hedera testnet)

### 1. Hedera accounts

You need 2–3 testnet accounts from **https://portal.hedera.com** (choose **Testnet**, ECDSA keys — raw, `0x`-hex and DER private keys all work). New accounts come with testnet HBAR. In `.env`:

```bash
CUSTOMER_ACCOUNT_ID=0.0.xxxxx      # the buyer agent
CUSTOMER_PRIVATE_KEY=...
TREASURY_ACCOUNT_ID=0.0.yyyyy      # receives the USDC
TREASURY_PRIVATE_KEY=...
OPERATOR_ACCOUNT_ID=0.0.yyyyy      # pays for HCS receipts; can be the treasury account
OPERATOR_PRIVATE_KEY=...
```

Get testnet USDC from https://faucet.circle.com (choose **Hedera Testnet**) for the **customer** account, then:

```bash
npm run setup-hedera    # associates USDC with each account, prints balances
npm run create-topic    # prints HCS_TOPIC_ID → paste into .env
```

One ₹49 ticket costs about 0.52 USDC, so 10 USDC buys about 19 tickets. Set `CUSTOMER_TOTAL_BUDGET` (see below) to make it last.

### 2. 0G, ENS, UPI (optional — each has a mock)

- **0G Compute** (the payout/hold decision): `npm run setup-0g`, fund the ledger from https://faucet.0g.ai, set `OG_MOCK=false`.
- **ENS merchant discovery** (Sepolia, ENSv2): `npm run register-parent` then `npm run setup-ens` once; onboard each merchant with `npm run add-merchant -- --label tickets --url http://localhost:5173/merchant/book --payTo 0.0.yyyyy --price 4900 --upi tickets@razorpay`. The merchant needs no wallet — Sangam issues them `<label>.sangam.eth`. Then `ENS_OFFLINE=false`.
- **Real UPI payouts** (RazorpayX test mode): set `PSP_MODE=razorpayx` with keys from https://razorpay.com. Approval can take days; everything stays mocked without it.

### 3. Pay

Fill in the customer keys, then on the dashboard click **Pay as agent** (a rail ticket) or **Buy on ONDC as agent** (goods from an ONDC seller). No approval step: the agent reads the 402, signs testnet USDC, retries — the payment lands in the pipeline and the receipt on HCS. From the command line:

```bash
npm run buy-ondc -- atta 1        # buy 10 kg atta through ONDC, paid in USDC
```

## Agent spending controls

| Control | Env var | What it does |
|---|---|---|
| Per payment | `CUSTOMER_MAX_PER_PAYMENT` (default `$1`) | Hard cap the x402 SDK enforces per transaction |
| Cumulative | `CUSTOMER_TOTAL_BUDGET` (e.g. `25`) | Total USDC across all purchases, persisted in `data/agent-budget.local.json`. The dashboard shows what's left; a purchase that would exceed it is refused with HTTP 429 — before anything is signed. |

Unset `CUSTOMER_TOTAL_BUDGET` = no cumulative cap.

## Use Sangam from your own agent (MCP)

Sangam ships as an MCP server, so any MCP client — Claude Code, Claude Desktop, an IDE agent — can discover merchants, buy with USDC and check settlements:

```bash
claude mcp add sangam -- npm run mcp      # from the repo root
```

| Tool | What it does |
|---|---|
| `lookup_merchant` | ENS name → endpoint, payTo, UPI handle, price |
| `search_catalog` | Search ONDC goods payable in USDC |
| `buy` | x402 purchase: signs USDC on Hedera, returns the tx + HashScan link |
| `settlement_status` | Settlement records: decision, rupees paid out, HCS receipt |

The MCP `buy` tool signs with the `CUSTOMER_*` key from `.env`; the per-payment cap applies, and the dashboard's own buyer additionally enforces the cumulative budget.

## Held payments: scheduled refunds

When the 0G decision is **hold** (an underpayment, or an ONDC order the seller never accepted), the USDC stays in Sangam's treasury and the pipeline schedules a refund: a `ScheduleCreateTransaction` that sends the USDC back to the payer. The schedule has no admin key — once created, nobody (including Sangam) can change or cancel it — and it executes once the treasury's signature is on it. If the operator and treasury are the same account it executes immediately; otherwise it waits, visibly, on HashScan (linked from the dashboard's Proof column).

## Receipt chain: tamper-evident by construction

Every settlement receipt on HCS carries `prev`: the sequence number and sha256 of the receipt before it. The dashboard's **Receipt chain** card replays the topic **from the Mirror Node** — not from Sangam's own files — and checks every link. Drop or reorder one receipt and the chain breaks for everyone to see.

## Identity: Aadhaar, in zero knowledge (Self offchain SDK)

Merchants and users verify once at **/verify**: pick your role, scan the QR with the [Self app](https://self.xyz), and the app builds a zero-knowledge proof from your Aadhaar QR (attestation id 3; passports and EU ID cards also work). Sangam's backend (`/api/self/verify`, the `SelfBackendVerifier` from `@selfxyz/core`) checks the proof and learns only what was disclosed — your name and that you're over 18. The Aadhaar number itself never leaves your phone; the proof's nullifier (one per person, per app) is the only id we store.

`NEXT_PUBLIC_SELF_MOCK=true` (default) uses Self's test documents while building. For real proofs the endpoint must be publicly reachable over https (deploy, or a tunnel): set `NEXT_PUBLIC_SELF_ENDPOINT` to the public origin and `NEXT_PUBLIC_SELF_MOCK=false` before building. The QR page and the verifier both read these (`apps/web/lib/self-config.ts`), so they always agree.

## Reference

| Command | What it does |
|---|---|
| `npm run dev` | The whole app on http://localhost:5173 |
| `npm run typecheck` | Typecheck every package and script |
| `npm run web:build` | Production build of the app |
| `npm run setup-hedera` | Associate USDC, print balances |
| `npm run create-topic` | Create the HCS receipt topic |
| `npm run setup-0g` | 0G balances, providers, `-- fund` |
| `npm run register-parent` | One-off: register sangam.eth on ENSv2 Sepolia |
| `npm run setup-ens` | One-off: make sangam.eth Sangam's merchant registry |
| `npm run add-merchant` | Onboard a merchant (issues their subname, writes records) |
| `npm run simulate` | Simulated payments, no money moves |
| `npm run buy-ondc` | Buy ONDC goods as the agent |
| `npm run mcp` | Run the MCP server (stdio) |
| `npm run gen-keys` | Print a shared secret + fresh EVM key |

**Layout:** `apps/web` is the whole app — `app/` routes (merchant x402 paywall, ONDC buyer, settlement API, dashboard, identity desk), `lib/server/` the settlement pipeline. `packages/hedera` (x402, Mirror Node, HCS, HTS, scheduled refunds, receipt chain), `packages/ens` (merchant discovery), `packages/og` (0G decisions), `packages/ondc` (buyer-app protocol), `packages/shared` (types, config, FX, UPI), `packages/mcp` (the agent-facing MCP server).

**Key env vars** (all in `.env.example` with comments): `CUSTOMER_*`, `TREASURY_*`, `OPERATOR_*`, `HCS_TOPIC_ID`, `CUSTOMER_MAX_PER_PAYMENT`, `CUSTOMER_TOTAL_BUDGET`, `SETTLEMENT_SHARED_SECRET`, `SANGAM_API_URL`, `OG_*`, `ENS_*`, `PSP_*`, `NEXT_PUBLIC_SELF_MOCK`, `NEXT_PUBLIC_SELF_ENDPOINT`.

## Running on Windows

PowerShell users: type `curl.exe` where this guide says `curl`, and use `Copy-Item .env.example .env`. If PowerShell blocks npm scripts, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. Every `npm run` command works unchanged.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `Missing env var X` | Fill in X in `.env`. |
| `command not found: node` (macOS) | Run the PATH export from Quickstart. |
| `'node' is not recognized` (Windows) | Open a new terminal after installing Node. |
| `EADDRINUSE` on 5173 | Something's already on the port. macOS/Linux: `lsof -nP -iTCP:5173 -sTCP:LISTEN`. |
| Circle faucet won't send USDC | The account isn't associated yet. Run `npm run setup-hedera` first. |
| `failed: transaction … not found on mirror node` | The Mirror Node lags; the pipeline retries ~15 s. If it persists, check the tx on HashScan. |
| `failed: treasury credited 0 …` | `hederaPayTo` isn't your treasury, or `HEDERA_USDC_TOKEN_ID` is wrong. |
| `expected 402 from merchant, got …` | The app isn't running, or the ENS `url` record points elsewhere. |
| Buyer refuses to pay | Price over `CUSTOMER_MAX_PER_PAYMENT`, or the cumulative `CUSTOMER_TOTAL_BUDGET` is used up. |
| Payment rejected by the facilitator | Try another `FACILITATOR_URL`: `https://x402.org/facilitator` or `https://testnet.facilitator.ax402.io`. |
| Scheduled refund not executing | It's waiting for the treasury's signature (operator ≠ treasury). Sign it, or set `TREASURY_PRIVATE_KEY`. |
| Receipt chain card shows "propagating" | The Mirror Node is a few seconds behind consensus. It catches up. |
| Self QR scans but never verifies | The endpoint must be reachable from the phone: in mock mode, check `NEXT_PUBLIC_SELF_MOCK=true` and use the Self app's test mode; for real proofs, deploy or tunnel and set `NEXT_PUBLIC_SELF_ENDPOINT`. |

## What's verified

| Part | Status |
|---|---|
| Real x402 payment: USDC leaves the customer, lands in the treasury, HashScan-verified | ✅ live on testnet |
| Mirror Node confirmation of every payment before payout | ✅ live |
| HCS receipts on topic 0.0.11264249, hash-chained, verified from the Mirror Node | ✅ live |
| ENS merchant discovery (ENSv2 subnames on Sepolia), ONDC subname issuing | ✅ live |
| 0G Compute decisions, 0G ledger | 🟡 code done; run with `OG_MOCK=false` + funds |
| RazorpayX UPI payout | 🟡 request built per docs; needs test keys to run |
| Scheduled refunds | 🟡 needs operator/treasury env set; verified by typecheck + smoke test |
| Agent budget | ✅ tested (429 path + dashboard bar) |
| MCP server | ✅ boots, tools run against live ENS + settlement data |
| Aadhaar identity (Self offchain SDK) | 🟡 mock mode by default; real proofs need a public https endpoint + `NEXT_PUBLIC_SELF_MOCK=false` |

## Built with

TypeScript, Next.js 16, `@x402/*` (Hedera exact scheme, Blocky402 facilitator), `@hiero-ledger/sdk`, `@selfxyz/core` + `@selfxyz/qrcode` (Aadhaar identity), `@0gfoundation/0g-compute-ts-sdk`, viem. Built with help from Claude Code; the spec it worked from is `docs/SPEC.md`.

MIT license.
