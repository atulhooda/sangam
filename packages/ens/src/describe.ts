import { flag, type EnsView } from "@sangam/shared";
import { resolveMerchant } from "./resolve.ts";
import { MERCHANT_FIELDS, MERCHANT_TEXT_KEYS } from "./records.ts";
import { parentName } from "./wallet.ts";


const etherscan = (a: string) => `https://sepolia.etherscan.io/address/${a}`;

/** Everything the dashboard shows about a merchant's ENS identity. */
export async function describeMerchant(name: string): Promise<EnsView> {
  const m = await resolveMerchant(name);
  const registry = process.env.ENS_SANGAM_REGISTRY || null;
  const resolver = process.env.ENS_SANGAM_RESOLVER || null;
  return {
    name,
    parent: parentName(),
    source: flag("ENS_OFFLINE") ? "offline" : "ens",
    records: MERCHANT_FIELDS.map((f) => ({ key: MERCHANT_TEXT_KEYS[f], value: String(m[f]) })),
    registry,
    resolver,
    links: {
      app: `https://sepolia.app.ens.domains/${name}`,
      registry: registry ? etherscan(registry) : null,
      resolver: resolver ? etherscan(resolver) : null,
    },
  };
}
