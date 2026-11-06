import { encodeAbiParameters, encodeFunctionData, keccak256, labelhash, namehash, parseAbi, parseEventLogs, toHex, type Hex } from "viem";
import { normalize, packetToBytes } from "viem/ens";
import { sepoliaClient } from "./client.ts";
import { ALL_ROLES, ENSV2_SEPOLIA, FACTORY_ABI, REGISTRY_ABI, RESOLVER_ABI, RESOLVER_INIT_ABI } from "./contracts.ts";
import { PRODUCTS_TEXT_KEY, PRODUCT_TEXT_KEYS, STORE_TEXT_KEY, readProductList } from "./products.ts";
import { EVM_COIN_TYPES, MERCHANT_TEXT_KEYS, STATUS_TEXT_KEY } from "./records.ts";
import { forgetMerchant } from "./resolve.ts";
import { parentName, sangamContracts, sangamWallet } from "./wallet.ts";

/*
 * Handing a merchant its name.
 *
 * Sangam's shared resolver grants permissions per record key across every
 * name in it, so it can't give one merchant control of only its own records.
 * Ownership therefore moves the merchant to a resolver of its own:
 *
 *   1. deploy a PermissionedResolver for the merchant (official ENS factory)
 *   2. copy the shop's and its products' current records into it
 *   3. grant the merchant's wallet every record it owns: url, price, UPI,
 *      payout addresses, products, store link, product details
 *   4. keep exactly one right for Sangam: setting sangam.status (the
 *      "verified" stamp), then revoke every other Sangam role on it,
 *      including the right to upgrade it
 *   5. point the shop's name (and its product names) at the new resolver
 *   6. transfer the name's token to the merchant's wallet
 *
 * After this Sangam cannot change the shop's prices or where its money goes;
 * it can only add or remove the verified stamp. (Sangam still controls
 * sangam.eth itself; locking that is a separate, irreversible step.)
 */

const OWNERSHIP_RESOLVER_ABI = parseAbi([
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
  "function revokeRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)",
  "function text(bytes32 node, string key) view returns (string)",
  "function addr(bytes32 node, uint256 coinType) view returns (bytes)",
]);
const TRANSFER_ABI = parseAbi([
  "function findTokenId(string label) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function unsafeTransfer(address to, uint256 tokenId, bytes data)",
]);

/** Text records a merchant writes itself once it owns its name (everything but the verified stamp). */
export const MERCHANT_OWNED_TEXT_KEYS = [
  ...Object.values(MERCHANT_TEXT_KEYS),
  PRODUCTS_TEXT_KEY,
  STORE_TEXT_KEY,
  ...Object.values(PRODUCT_TEXT_KEYS),
] as const;

const dns = (name: string) => toHex(packetToBytes(name));
const ZERO = "0x0000000000000000000000000000000000000000";

export type OwnershipStep = { step: string; tx: Hex };
export type Ownership = { resolver: Hex; owner: Hex; tokenId: string; names: string[]; steps: OwnershipStep[] };

/**
 * Every record of `name`, read through ENS (the name still points at the
 * shared resolver; it only answers through ENS resolution, not direct
 * reads), as setter calls for the new resolver.
 */
async function copyCalls(name: string): Promise<Hex[]> {
  const client = sepoliaClient();
  const n = dns(name);
  const calls: Hex[] = [];
  const keys = [...MERCHANT_OWNED_TEXT_KEYS, STATUS_TEXT_KEY];
  const values = await Promise.all(keys.map((key) => client.getEnsText({ name, key }).catch(() => null)));
  keys.forEach((key, i) => {
    const value = values[i];
    if (value) calls.push(encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [n, key, value] }));
  });
  for (const coinType of EVM_COIN_TYPES) {
    const a = await client.getEnsAddress({ name, coinType }).catch(() => null);
    if (a && a !== ZERO) calls.push(encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setAddress", args: [n, coinType, a] }));
  }
  return calls;
}

export async function transferToMerchant(merchantName: string, owner: Hex, log: (m: string) => void = () => undefined): Promise<Ownership> {
  const name = normalize(merchantName);
  const suffix = `.${parentName()}`;
  if (!name.endsWith(suffix)) throw new Error(`${name} is not under ${parentName()}`);
  const label = name.slice(0, -suffix.length);
  const client = sepoliaClient();
  const wallet = sangamWallet();
  const me = wallet.account.address;
  const { registry, resolver: shared } = sangamContracts();
  const steps: OwnershipStep[] = [];
  const send = async (step: string, tx: Hex) => {
    const r = await client.waitForTransactionReceipt({ hash: tx });
    if (r.status !== "success") throw new Error(`${step} reverted (${tx})`);
    steps.push({ step, tx });
    log(`  ${step}: ${tx}`);
    return r;
  };

  const current = await client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getResolver", args: [label] });
  if (current === ZERO) throw new Error(`${name} isn't registered`);
  if (current.toLowerCase() !== shared.toLowerCase()) throw new Error(`${name} already has its own resolver (${current})`);

  // The shop and its products all move to the new resolver.
  const productLabels = await readProductList(name).catch(() => []);
  const productRegistry = await client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getSubregistry", args: [label] });
  const names = [name, ...productLabels.map((l) => `${l}.${name}`)];

  // 1. A resolver of the shop's own, from the ENS factory, Sangam as its temporary admin.
  log(`creating ${name}'s own resolver…`);
  const salt = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }], [keccak256(toHex("SangamMerchantResolver")), namehash(name), owner])));
  const init = encodeFunctionData({ abi: RESOLVER_INIT_ABI, functionName: "initialize", args: [[{ account: me, roleBitmap: ALL_ROLES }], []] });
  const deployTx = await wallet.writeContract({ address: ENSV2_SEPOLIA.VerifiableFactory, abi: FACTORY_ABI, functionName: "deployProxy", args: [ENSV2_SEPOLIA.PermissionedResolverImpl, salt, init] });
  const receipt = await send("deploy resolver", deployTx);
  const [event] = parseEventLogs({ abi: FACTORY_ABI, eventName: "ProxyDeployed", logs: receipt.logs });
  if (!event) throw new Error(`no ProxyDeployed in ${deployTx}`);
  const resolver = event.args.proxyAddress;

  // 2. Copy the records over, so nothing resolves differently after the switch.
  const copies = (await Promise.all(names.map((n) => copyCalls(n)))).flat();
  if (copies.length === 0) throw new Error(`could not read ${name}'s records from ENS; not moving it`);
  for (let i = 0; i < copies.length; i += 60) {
    await send(`copy records ${i / 60 + 1}`, await wallet.writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: "multicall", args: [copies.slice(i, i + 60)] }));
  }

  // 3 + 4. The merchant gets its records; Sangam keeps only the verified stamp, then drops everything else.
  const grant = (setter: Hex, account: Hex) => encodeFunctionData({ abi: OWNERSHIP_RESOLVER_ABI, functionName: "grantSetterRoles", args: [setter, account] });
  const n0 = dns(name);
  const roles: Hex[] = [
    ...MERCHANT_OWNED_TEXT_KEYS.map((key) => grant(encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [n0, key, ""] }), owner)),
    ...EVM_COIN_TYPES.map((ct) => grant(encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setAddress", args: [n0, ct, "0x"] }), owner)),
    grant(encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [n0, STATUS_TEXT_KEY, ""] }), me),
    encodeFunctionData({ abi: OWNERSHIP_RESOLVER_ABI, functionName: "revokeRootRoles", args: [ALL_ROLES, me] }),
  ];
  await send("hand records to the merchant", await wallet.writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: "multicall", args: [roles] }));

  // 5. Point the shop's name and its products at the new resolver.
  await send("point name at it", await wallet.writeContract({ address: registry, abi: REGISTRY_ABI, functionName: "setResolver", args: [BigInt(labelhash(label)), resolver] }));
  if (productRegistry !== ZERO) {
    for (const l of productLabels) {
      await send(`point ${l} at it`, await wallet.writeContract({ address: productRegistry, abi: REGISTRY_ABI, functionName: "setResolver", args: [BigInt(labelhash(l)), resolver] }));
    }
  }

  // 6. The name's token goes to the merchant's wallet. ENSv2 calls this an
  // "unsafe" transfer while the parent registry isn't emancipated: Sangam, as
  // owner of sangam.eth, could still reclaim it. Locking that is the separate,
  // irreversible step (safeTransferFrom is refused until then).
  const tokenId = await client.readContract({ address: registry, abi: TRANSFER_ABI, functionName: "findTokenId", args: [label] });
  await send("transfer name", await wallet.writeContract({ address: registry, abi: TRANSFER_ABI, functionName: "unsafeTransfer", args: [owner, tokenId, "0x"] }));

  for (const n of names) forgetMerchant(n);
  return { resolver, owner, tokenId: tokenId.toString(), names, steps };
}

/** Who can do what on a merchant's own resolver, for the desk and for judges. */
export async function ownershipFacts(resolver: Hex, owner: Hex) {
  const client = sepoliaClient();
  const sangam = sangamWallet().account.address;
  const sangamRoot = await client.readContract({ address: resolver, abi: OWNERSHIP_RESOLVER_ABI, functionName: "hasRootRoles", args: [ALL_ROLES, sangam] }).catch(() => null);
  return { resolver, owner, sangamHasRootRoles: sangamRoot };
}

/** Sangam's one remaining right on an owned name: the verified stamp. */
export async function setVerifiedStamp(merchantName: string, resolver: Hex, status: "verified" | "suspended"): Promise<Hex> {
  const name = normalize(merchantName);
  const tx = await sangamWallet().writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: "setText", args: [dns(name), STATUS_TEXT_KEY, status] });
  await sepoliaClient().waitForTransactionReceipt({ hash: tx });
  forgetMerchant(name);
  return tx;
}

/**
 * Setter calls a merchant's wallet sends to its own resolver (price, UPI,
 * product records): the server builds them, the merchant signs them.
 */
export function merchantRecordCalls(records: { name: string; key: string; value: string }[]): Hex[] {
  return records.map((r) => encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [dns(normalize(r.name)), r.key, r.value] }));
}

export { RESOLVER_ABI as OWNED_RESOLVER_ABI };
