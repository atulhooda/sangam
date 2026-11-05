# Sangam - Hackathon PRD

**Agents pay in USDC. Merchants get rupees.**
ETHGlobal Mumbai · Hedera tracks: **AI Agents That Pay: x402 on Hedera** (primary) and **"No Solidity Allowed": Hedera SDKs**.

> Status legend used throughout: **✅ live on testnet** · **🟡 built, running in mock mode** · **⬜ planned**

---

## 1. Problem Statement

AI agents can now do real work on their own, but they can't pay the way the internet expects: checkout pages, card details, OTPs, sign-ups and API keys all assume a human. On the other side, Indian merchants sell over APIs (tickets, groceries, recharges) but can only take rupees, and can't hold or verify crypto.

So there are machine customers with stablecoins on one side, real merchants with UPI accounts on the other, and nothing in between to **verify the crypto payment, decide whether it's safe, convert it, pay the merchant in INR, and keep an audit trail**.

**Target users**
- **Primary:** developers building AI agents that need to buy from Indian merchants (travel, food, commerce, data).
- **Secondary:** Indian merchants and ONDC sellers that want agent customers without touching crypto.

**Current solutions and gaps** (from a market scan during the hackathon)
| What exists | Gap |
|---|---|
| x402 API marketplaces (e.g. PayAPI Market, ~2,300 listed APIs) | Agents can pay per call, but there are no Indian merchants and no rupee settlement |
| Indian AI-API resellers that bill in rupees (e.g. Top Billing) | Rupees work, but payment is human-shaped: account + UPI top-up |
| ONDC (India's open commerce network) | Real catalogs and a machine-to-machine protocol, but payment assumes a registered human buyer app |
| Merchant APIs (IRCTC partners, BBPS aggregators, Delhivery) | Behind KYC, contracts and monthly invoicing; an agent can't get through the door |

Nobody combines **402-native payment + Indian merchant + UPI settlement + real goods**. That's Sangam.

**Why Web3?** The payer is software with no bank account, no card and no legal identity. A stablecoin on Hedera is the only payment rail an agent can use on its own, settled in seconds, priced per call, with no account opening. The merchant's guarantee comes from consensus, not from trusting Sangam: the payment is verifiable on the Mirror Node and every settlement is written to an HCS topic that nobody, including Sangam, can rewrite.

---

## 2. Solution Overview

Sangam is a settlement rail between AI agents and Indian merchants. A merchant's API answers an unpaid request with **HTTP 402** and an x402 invoice. The agent signs a **USDC (HTS) transfer** and retries; the Blocky402 facilitator submits it to Hedera and the agent gets its goods. Sangam then **verifies the transfer on the Mirror Node**, runs a **payout-or-hold decision**, converts to INR at the live rate, **pays the merchant over UPI**, and writes a **receipt to HCS**. Merchants are discovered by ENS name (`tickets.sangam.eth`), and real goods come from **ONDC**, with Sangam acting as the buyer app.

**Track alignment**
- **x402 on Hedera:** x402-protected endpoints settling HTS USDC on Hedera through Blocky402; an agent completing paid requests with no human approval; HCS audit logs and HTS settlement (both bonus items); a per-payment spending cap (bonus item, partial).
- **No Solidity Allowed:** zero smart contracts; built only on the Hiero JS SDK and native services (HTS + HCS) plus the Mirror Node REST API (bonus item).

### Key Features (MVP)
1. ✅ **x402 paywall on Hedera:** `/merchant/book` (₹49 rail ticket) and `/merchant/ondc/order` (ONDC goods). This is the core track requirement.
2. ✅ **Autonomous agent payment:** "Pay as agent" signs real testnet USDC with no approval step, capped per payment. Proves the "no human" requirement.
3. ✅ **Chain-verified settlement:** Mirror Node check of success, amount, destination and payer before any payout, so payouts rely on consensus, not the merchant's word.
4. ✅ **HCS receipts:** every real settlement goes to topic `0.0.11264249`. Tamper-proof audit trail.
5. ✅ **Live settlement dashboard:** pipeline view, 402 invoice decoder, HashScan and topic links. Makes the flow visible to judges and merchants.

### Non-Goals (v1)
- No mainnet, no real money: testnet USDC only.
- No custody of agent keys or merchant bank logins.
- No production UPI payouts until RazorpayX enables payouts on the account (🟡 mocked today).
- No real ONDC seller until staging registration (🟡 a signed mock seller is used).
- No smart contracts (deliberate, for the No-Solidity track).

---

## 3. Hedera Integration Architecture

### Network Services Used
| Service | Purpose in Sangam | Why this service? | Status |
|---|---|---|---|
| **HTS** | The payment: USDC token `0.0.429274` from agent to treasury `0.0.11227656`; treasury association | Native token transfer: no contract risk, low fixed fees, seconds to finality | ✅ |
| **x402 (Hedera exact scheme)** via **Blocky402** | 402 invoice → signed transfer → facilitator settles and pays the HBAR fee | HTTP-native, per-request payment with no checkout, and the agent needs no HBAR | ✅ |
| **Mirror Node REST** | `confirmPayment()`: result = SUCCESS, USDC credited ≥ claimed, payer | Read-only and independent: Sangam verifies, doesn't trust | ✅ |
| **HCS** | `writeReceipt()` per settlement on a topic only Sangam's key can write to; each receipt carries the previous receipt's sha256 (`prev`), so the chain can be replayed and verified from the Mirror Node alone | Ordered, timestamped, immutable, hash-chained audit log | ✅ |
| **HashScan** | Public proof links for every transaction, topic and refund schedule | Judges and merchants can check without trusting us | ✅ |
| **Scheduled Transactions** | A held payment schedules a USDC refund back to the payer (no admin key, immutable; executes when the treasury's signature is on it) | Native multi-sig, deferred execution, no contract | ✅ |
| **Hedera Agent Kit / MCP** | Sangam ships an MCP server (`npm run mcp`): `lookup_merchant`, `search_catalog`, `buy`, `settlement_status` — any MCP client (Claude Code, Claude Desktop) can pay Indian merchants | Brings the whole Agent Kit audience to Sangam | ✅ |

### Ecosystem Integrations
| Partner/Platform | Integration | Value |
|---|---|---|
| **Blocky402** (x402 facilitator) | Verifies and settles every agent payment | Agents pay with no HBAR; standard x402 flow |
| **HashScan** | Proof links on the dashboard and README | Instant third-party verification |
| **ENS (ENSv2, Sepolia)** | Merchant registry: Sangam issues `<merchant>.sangam.eth` subnames whose records hold the Hedera payTo, price and UPI ID | Agents find a merchant's Hedera account by name |
| **ONDC** (protocol) | Sangam as buyer app: signed search → select → init → confirm | Opens India's open commerce network to Hedera payments |
| **RazorpayX** | INR payout over UPI | The merchant gets rupees, not crypto (🟡) |
| **0G Compute** | Payout-or-hold risk decision with verifiable responses | Explainable judgement per payment (🟡) |
| **Self** (offchain SDK) | Merchants & users verify with an Aadhaar QR at `/verify`; zero-knowledge proof verified at `/api/self/verify` | Identity without exposing the Aadhaar number; one nullifier per person (✅, mock mode default) |

### Architecture
```
 AI agent ──(1) ENS: tickets.sangam.eth → url, payTo 0.0.11227656, ₹ price, UPI
    │
    ├─(2) GET /merchant/book ──────────────▶ 402 + x402 invoice (USDC 0.0.429274)
    ├─(3) sign USDC transfer (HTS) ─▶ Blocky402 ─▶ HEDERA ─▶ 200 OK + ticket
    │                                                │
    │              merchant ──notice (tx id)──▶ SANGAM settlement pipeline
    │                                                │
    │   (4) Mirror Node: SUCCESS? credited ≥ claimed? payer?   ── HEDERA (read)
    │   (5) decide (0G) → FX → 50 bps fee → UPI payout (RazorpayX)
    │   (6) HCS receipt → topic 0.0.11264249 (seq #n)          ── HEDERA (write)
    ▼
 Dashboard: pipeline · HashScan tx · HCS topic · ENS records · ONDC order
```
Hedera transactions per real settlement: **1 HTS transfer + 1 HCS message**, plus **N Mirror Node reads**.

---

## 4. Hedera Network Impact
*All numbers below are planning estimates, not traction.*

### Account Creation
- Every agent that pays through Sangam needs its own Hedera account holding USDC; merchants don't need one (they're paid in INR).
- **Estimate:** 50 agent accounts in the first 3 months (developer pilots); 1,000 within 12 months if published as an Agent Kit / MCP tool.

### Active Accounts
- Agents pay per request, so active agents are active accounts every month by design.
- **Estimate:** 30–60% of created agent accounts active monthly.

### Transactions
- 2 Hedera transactions per settlement (HTS + HCS), more with refunds via scheduled transactions.
- **Estimate:** pilot of 5 merchants × 50 orders/day ≈ 500 tx/day; scale (100 merchants × 200 orders/day) ≈ 40,000 tx/day.

### Audience Exposure
- **Indian merchants and ONDC sellers**, an audience with essentially no Hedera exposure today.
- **AI-agent developers** looking for a pay-per-call rail with real-world merchants.

---

## 5. Innovation & Differentiation

**Ecosystem gap:** Hedera's x402 work shows agents paying for APIs and data. Nothing connects those payments to **real-world merchants paid in local fiat**, with on-chain verification and an audit log in between.

**Cross-chain comparison:** x402 marketplaces on Base and Solana settle to crypto-native sellers. Stripe-based agent rails settle in USD to Stripe merchants. None offer **USDC-in → UPI-rupees-out** for Indian merchants, or an **ONDC** buyer app paid by agents.

**Novel Hedera usage**
- **HCS as the settlement ledger of record:** each receipt binds the Hedera payment, the FX rate, the risk decision, the UPI payout reference and the ONDC order into one consensus-timestamped message, an audit trail across three systems.
- **Mirror Node as the gate for fiat payout:** a rupee payout only happens after independent chain verification.
- **ENS → Hedera:** a merchant's Hedera payTo lives in ENSv2 records that Sangam issues, so agents discover Hedera accounts by human-readable name.

---

## 6. Feasibility & Business Model

### Technical Feasibility
- **Services:** HTS, HCS (hash-chained), Mirror Node, x402 + Blocky402, Scheduled Transactions, MCP (all live); RazorpayX + 0G live with keys.
- **Team capabilities:** full-stack TypeScript/Next.js, the Hiero JS SDK, viem/ENS, the ONDC protocol (signing, async callbacks).
- **Risks → mitigations**
  | Risk | Mitigation |
  |---|---|
  | Mirror Node lag | Poll for up to ~15 s, then fail safe (no payout) |
  | Public RPC flakiness (Sepolia for ENS) | Fallback RPCs + last-good ENS cache (never a stale payTo) |
  | UPI payouts not enabled on RazorpayX | Mock mode, clearly labelled; enable before the pilot |
  | ONDC staging access | Spec-faithful signed mock seller; switching to a real seller is a registry and URL change |
  | FX moves between quote and settlement | Rate recorded per settlement and in the HCS receipt |

### Business Model (Lean Canvas)
| Element | Description |
|---|---|
| **Problem** | 1) Agents can't pay Indian merchants. 2) Merchants can't accept or verify crypto. 3) No audit trail across chain, risk and fiat payout. |
| **Solution** | 1) x402 paywall + USDC on Hedera. 2) Mirror Node verification + UPI payout in INR. 3) An HCS receipt per settlement. |
| **Key metrics** | Settlements/day, ₹ paid out, % held, verification time, active agent accounts |
| **Unique value prop** | "Sell to AI agents tomorrow and get paid in rupees, with no crypto on your side." |
| **Unfair advantage** | ONDC buyer-app integration + UPI rails + an ENS merchant registry; India-specific compliance knowledge |
| **Channels** | Hedera Agent Kit / MCP listing, x402 directories, ONDC seller network, Indian API aggregators |
| **Customer segments** | Agent developers (demand side); Indian API merchants and ONDC sellers (supply side) |
| **Cost structure** | Hedera fees (fixed and tiny), UPI payout fees, FX spread, hosting, compliance |
| **Revenue streams** | 50 bps settlement fee (implemented); later FX margin, premium risk checks, merchant onboarding |

### Why Web3 is Required
The buyer is software with no legal identity or bank account. Only a programmable stablecoin lets it pay instantly and per request. The merchant's protection comes from consensus (Mirror Node verification and immutable HCS receipts), not from trusting Sangam's database.

---

## 7. Execution Plan

### MVP Scope (Hackathon)
| Feature | Priority | Effort | Hedera service | Status |
|---|---|---|---|---|
| x402 paywall + Blocky402 settlement | P0 | 1 day | HTS, x402 | ✅ |
| Agent pays with no approval | P0 | 0.5 day | HTS | ✅ |
| Mirror Node verification | P0 | 0.5 day | Mirror Node | ✅ |
| HCS receipt per settlement | P0 | 0.5 day | HCS | ✅ |
| Dashboard with HashScan/topic proof | P0 | 1 day | - | ✅ |
| ONDC order paid in USDC | P1 | 1.5 days | HTS, HCS | ✅ (mock seller) |
| **Total agent budget** (per-payment cap exists) | P1 | 1 hour | Mirror Node | ✅ (`CUSTOMER_TOTAL_BUDGET`, persisted ledger, 429 before signing, shown on dashboard) |
| Hash-chained HCS receipts + verify on dashboard | P1 | 0.5 day | HCS, Mirror Node | ✅ (each receipt carries `prev`; dashboard replays the chain from the Mirror Node) |
| Scheduled-transaction refunds for held payments | P2 | 1 day | Scheduled Tx | ✅ (no admin key; auto-signs when operator = treasury, else waits on HashScan) |
| Agent Kit / MCP tool | P2 | 1 day | Agent Kit | ✅ (stdio MCP server, 4 tools, `claude mcp add sangam -- npm run mcp`) |
| Aadhaar identity for merchants & users (Self offchain SDK) | P1 | 0.5 day | - (offchain proofs at `/api/self/verify`) | ✅ (zk proof from the Aadhaar QR; only name + over-18 disclosed; mock mode default) |

### Team Roles
| Member | Role | Responsibilities |
|---|---|---|
| Nishant | Lead engineer | Hedera/x402 rail, settlement pipeline, ONDC, ENS, dashboard |
| Teammate | Product & pitch | Merchant outreach and feedback cycles, demo video, pitch, GTM |
*(Edit names and split as needed.)*

### Design Decisions
| Decision | Options | Choice | Rationale |
|---|---|---|---|
| Payment token | HBAR vs HTS USDC | **HTS USDC** | Stable value for INR conversion; native token, no contract |
| Payment protocol | Custom API vs x402 | **x402** | Standard agent payment flow; track requirement |
| Facilitator | Self-run vs Blocky402 | **Blocky402** | Pays HBAR fees; agents need no HBAR |
| Verification | Trust the merchant notice vs Mirror Node | **Mirror Node** | Payout gated on consensus, not on claims |
| Audit trail | Database only vs HCS | **HCS** | Immutable, ordered, publicly checkable |
| Contracts | Solidity escrow vs none | **None** | Lower risk, No-Solidity track; HTS + HCS cover the need |
| App structure | Separate servers vs one Next.js app | **One app + a package per sponsor** | One deploy; judges find all Hedera code in `packages/hedera` |

### Post-Hackathon Roadmap
- **Months 1–2:** enable RazorpayX payouts; first 3–5 pilot merchants; total budgets and scheduled refunds.
- **Months 3–6:** ONDC staging registration and a real seller; Agent Kit / MCP listing; hosted database; mainnet readiness.
- **Months 6–12:** mainnet; more categories (BBPS bills, recharges, logistics); compliance review for INR settlement.

---

## 8. Validation Strategy
**Current state: no external validation yet.** Only the team has tested Sangam. Every conversation goes in `docs/FEEDBACK-LOG.md` (date, who, what they tried, quote, follow-up) — that log is the evidence. Plan:

### Feedback Sources
- **Agent developers:** Hedera and ETHGlobal Discords, Agent Kit community. Ask: "Would you route agent purchases through this?"
- **Merchants:** 5–10 small Indian API merchants or ONDC sellers. Ask: "Would you accept agent orders paid out in INR at 50 bps?"
- **Hackathon mentors** (Hedera, ONDC-aware SMEs).

### Validation Milestones
| Milestone | Target | Timeline |
|---|---|---|
| Developer conversations | 10 | During the hackathon |
| Developers who run a test payment | 3 | During the hackathon |
| Merchant interviews | 5 | Week after |
| Letters of intent / pilot commitments | 1–2 | Month 1 |

### Feedback Cycles
1. **Cycle 1 (hackathon):** share the dashboard + "Pay as agent" with developers; record friction and feature asks.
2. **Cycle 2 (month 1):** pilot with one merchant on testnet; measure verification time and hold rate; iterate.

---

## 9. Go-To-Market Strategy
*Market sizes below must be cited before the pitch (e.g. NPCI's monthly UPI statistics, ONDC's published network figures). Do not quote unsourced numbers.*

- **Initial target segment:** agent developers who need Indian travel and commerce purchases, plus ONDC sellers.
- **Distribution:** 1) list Sangam as an Agent Kit / MCP tool and in x402 directories; 2) partner with ONDC seller apps; 3) Indian API aggregators (recharge, BBPS).
- **Growth:** every merchant gets an ENS subname (`<merchant>.sangam.eth`), so the registry itself becomes the merchant directory agents browse.

---

## 10. Pitch Outline
1. **Problem (30 s):** "AI agents have money. Indian merchants want rupees. Neither can pay the other."
2. **Solution + demo (60 s):** click **Pay as agent** → 402 → USDC on Hedera → Verified → Paid → Receipt.
3. **Hedera (45 s):** HTS moves the money, x402 lets the agent pay with no checkout, the Mirror Node proves it arrived, HCS keeps the receipt. No smart contracts. Show the HashScan tx and the topic.
4. **Traction (30 s):** be honest: live testnet settlements and an ONDC order; feedback cycles under way.
5. **Opportunity (30 s):** India's UPI scale (cite NPCI) × the agent economy; 50 bps per settlement.
6. **Next (15 s):** UPI payouts live, real ONDC sellers, Agent Kit listing.

### Key Metrics to Present (all real)
- Settled x402 payment: `0.0.7162784@1793527403.177518448` ([HashScan](https://hashscan.io/testnet/transaction/0.0.7162784%401793527403.177518448))
- HCS receipt topic: `0.0.11264249` with receipts #1–#4 ([HashScan](https://hashscan.io/testnet/topic/0.0.11264249))
- ONDC order `ANP-E64E739A` paid in USDC (mock seller), seller paid ₹457.70 after the 50 bps fee (mock UPI)

### Be explicit about what's mocked
UPI payout (RazorpayX payouts not enabled yet), the 0G decision (`OG_MOCK=true`), and the ONDC seller. All Hedera steps are real on testnet.

---

## Parking Lot
- HCS-14 / ERC-8004 agent identity feeding the risk decision
- Multi-agent price negotiation (A2A) before the 402
- Recurring payments (subscriptions) via scheduled transactions
- Merchant self-serve onboarding: issue an ENS subname and start accepting agents
- Multi-key treasury (KeyList / threshold key)

---

## Section-to-Criteria Mapping
| PRD section | Criteria |
|---|---|
| 1 Problem | Feasibility, Pitch |
| 2 Solution | Innovation, Pitch, Execution |
| 3 Hedera Integration | Integration, Innovation |
| 4 Network Impact | Success |
| 5 Innovation | Innovation |
| 6 Feasibility | Feasibility |
| 7 Execution | Execution |
| 8 Validation | Validation |
| 9 GTM | Execution, Success |
| 10 Pitch | Pitch |
