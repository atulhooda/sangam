// One-off: register ENS_PARENT_NAME (sangam.eth) on ENSv2 Sepolia for the
// ENS_OWNER_PRIVATE_KEY wallet. Pays in free MockUSDC; needs a little Sepolia ETH for gas.
//   npm run register-parent
import { registerParent } from "@sangam/ens";

const { expiry, txs } = await registerParent(1, (m) => console.log(m));
for (const t of txs) console.log(`  ${t.step}: https://sepolia.etherscan.io/tx/${t.tx}`);
console.log(`registered, expires ${expiry.toISOString().slice(0, 10)}. Next: npm run setup-ens`);
