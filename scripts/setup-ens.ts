// One-off: make sangam.eth Sangam's ENSv2 merchant registry (Sepolia).
// Register sangam.eth (ENS_PARENT_NAME) at sepolia.app.ens.domains with the
// ENS_OWNER_PRIVATE_KEY wallet first. Prints the two addresses for .env.
//   npm run setup-ens
import { setupSangamRegistry } from "@sangam/ens";

const { registry, resolver } = await setupSangamRegistry((m) => console.log(m));
console.log("\nPaste into .env:");
console.log(`ENS_SANGAM_REGISTRY=${registry}`);
console.log(`ENS_SANGAM_RESOLVER=${resolver}`);
