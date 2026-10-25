// Print a fresh shared secret and a fresh EVM key. Works the same on macOS, Linux and Windows.
//   npm run gen-keys
import { randomBytes } from "node:crypto";
import { Wallet } from "ethers";

const wallet = Wallet.createRandom();

console.log("Paste into .env:\n");
console.log(`SETTLEMENT_SHARED_SECRET=${randomBytes(32).toString("hex")}`);
console.log(`OG_PRIVATE_KEY=${wallet.privateKey}`);
console.log(`ENS_OWNER_PRIVATE_KEY=${wallet.privateKey}`);
console.log(`\nEVM address (send OG and Sepolia ETH here): ${wallet.address}`);
