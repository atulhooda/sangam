# Whitechain feedback

Notes from adding Whitechain as Sangam's second payment rail during ETHGlobal Mumbai.

**What worked**

- Whitechain Sepolia behaves like any OP Stack chain: viem, `eth_getLogs` with an address list,
  and ~1 s blocks made verification and the deposit watcher simple.
- The test USDT implements EIP-3009 `transferWithAuthorization`, which is what makes a
  gasless x402 flow possible. The stock `@x402/evm` exact scheme worked against it unchanged.
- The explorer is Blockscout, so contract verification from a standard-JSON input works over its API.

**Where we got stuck**

- The prize page gives no RPC URL. We found `https://rpc.testnet.whitechain.io` (chain 1874) by
  trying hostnames; `https://rpc-testnet.whitechain.io` also answers but on chain 2625, an older
  testnet, which is easy to pick up by mistake.
- The USDT's `version()` and `eip712Domain()` revert, so the EIP-712 domain needed for signing
  isn't readable on chain. We recovered it (`Tether USD`, version `1`) by hashing candidates
  against `DOMAIN_SEPARATOR()`.
- There is no x402 facilitator for Whitechain, so we built one into Sangam (`@sangam/whitechain`).

**What the docs could add**

- The testnet RPC URL and chain ID on the same page as the faucet.
- The USDT's EIP-712 name and version, and a note that it supports EIP-3009.
