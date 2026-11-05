# @sangam/og

**Role:** the payout-or-hold decision for every settlement runs on 0G Compute (a bonus integration, not a prize target).

| File | What it does |
|---|---|
| `src/broker.ts` | 0G Compute broker for `OG_PRIVATE_KEY`, created once per process. |
| `src/decide.ts` | `decide()`: risk-officer prompt to the `OG_PROVIDER_ADDRESS` provider, strict JSON reply, `processResponse()` check that the reply came from that provider; a malformed reply is held, never paid. `mockDecision()`: the same rules locally when `OG_MOCK=true`. |
| `src/ledger.ts` | `ogBalance()`: the 0G ledger balance shown on the dashboard. Top-up is `npm run setup-0g -- fund`. |
