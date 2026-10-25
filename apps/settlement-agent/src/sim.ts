// Start settlement-agent in simulation mode on any OS (no shell env prefix needed).
// Set before server.ts loads .env; dotenv doesn't override values already set.
process.env.SKIP_CHAIN_VERIFY = "true";
await import("./server.ts");

export {};
