import { encodeAbiParameters, encodeFunctionData, keccak256, labelhash, namehash, parseEventLogs, toHex, type Hex } from "viem";
import { normalize, packetToBytes } from "viem/ens";
import { sepoliaClient } from "./client.ts";
import { ALL_ROLES, ENSV2_SEPOLIA, FACTORY_ABI, REGISTRY_ABI, REGISTRY_ROLES, RESOLVER_ABI, USER_REGISTRY_INIT_ABI } from "./contracts.ts";
import { EVM_COIN_TYPES, MERCHANT_TEXT_KEYS, STATUS_TEXT_KEY } from "./records.ts";
import { forgetMerchant, resolveMerchant } from "./resolve.ts";
import { validLabel } from "./subnames.ts";
import { parentName, sangamContracts, sangamWallet } from "./wallet.ts";

/*
 * Every product a verified merchant sells gets its own ENS name under the
 * merchant's: truffle-cake.bakery.sangam.eth. The product name carries the
 * same records an agent checks before paying a merchant (price, payout
 * accounts, sangam.status), so the "verified merchants only" check works per
 * product: a hacked shop can't bill more than the product's ENS price or send
 * the money anywhere but the shop's own accounts.
 *
 * ENSv2: a merchant name gets its own UserRegistry (deployed once, from the
 * official ENS factory) and each product is a token in it. Records live in
 * Sangam's PermissionedResolver, like the merchant's. The list of products is
 * published on the merchant's name (sangam.products), so a storefront can be
 * rebuilt from ENS alone.
 */

/** Text-record keys a product publishes on top of the merchant ones. */
export const PRODUCT_TEXT_KEYS = {
  merchant: "sangam.merchant",
  title: "sangam.product",
  description: "description",
  image: "avatar",
} as const;

/** On the merchant's name: comma-separated product labels, in shop order. */
export const PRODUCTS_TEXT_KEY = "sangam.products";
/** On the merchant's name: the public link to its storefront (its menu). */
export const STORE_TEXT_KEY = "sangam.store";

export type ProductInput = {
  /** Display name, e.g. "Chocolate truffle cake". */
  title: string;
  priceInrPaise: number;
  description?: string;
  image?: string;
};

export type Product = ProductInput & { label: string; ensName: string; merchant: string };

/** "Chocolate Truffle Cake (1 kg)" → "chocolate-truffle-cake-1-kg", valid as an ENS label. */
export function productLabel(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : `${slug || "item"}-${"x".repeat(Math.max(0, 3 - slug.length - 1))}`.slice(0, 60);
}

const ZERO = "0x0000000000000000000000000000000000000000";
const PRODUCT_ROLES = REGISTRY_ROLES.ROLE_SET_RESOLVER | REGISTRY_ROLES.ROLE_RENEW | REGISTRY_ROLES.ROLE_CAN_TRANSFER_ADMIN;
const dns = (name: string) => toHex(packetToBytes(name));

type Log = (msg: string) => void;
export type ProductTx = { step: string; tx: Hex };

/** The merchant's own UserRegistry (product names live in it). Deploys and links it on first use. */
export async function ensureMerchantRegistry(merchantName: string, log: Log = () => undefined): Promise<{ registry: Hex; txs: ProductTx[] }> {
  const name = normalize(merchantName);
  const label = merchantLabel(name);
  const client = sepoliaClient();
  const wallet = sangamWallet();
  const { registry: sangamRegistry } = sangamContracts();
  const txs: ProductTx[] = [];

  const existing = await client.readContract({ address: sangamRegistry, abi: REGISTRY_ABI, functionName: "getSubregistry", args: [label] });
  if (existing !== ZERO) return { registry: existing, txs };

  // 1. Deploy a UserRegistry for <merchant>.sangam.eth from the ENS factory (deterministic, verifiable).
  log(`creating ${name}'s product registry…`);
  const salt = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [keccak256(toHex("UserRegistry")), namehash(name), 0n])));
  const init = encodeFunctionData({ abi: USER_REGISTRY_INIT_ABI, functionName: "initialize", args: [[{ account: wallet.account.address, roleBitmap: ALL_ROLES }]] });
  const deployTx = await wallet.writeContract({ address: ENSV2_SEPOLIA.VerifiableFactory, abi: FACTORY_ABI, functionName: "deployProxy", args: [ENSV2_SEPOLIA.UserRegistryImpl, salt, init] });
  const receipt = await client.waitForTransactionReceipt({ hash: deployTx });
  const [event] = parseEventLogs({ abi: FACTORY_ABI, eventName: "ProxyDeployed", logs: receipt.logs });
  if (!event) throw new Error(`no ProxyDeployed event in ${deployTx}`);
  const registry = event.args.proxyAddress;
  txs.push({ step: "deploy product registry", tx: deployTx });

  // 2. Link it both ways: its parent is the merchant's token in Sangam's registry…
  const parentTx = await wallet.writeContract({ address: registry, abi: REGISTRY_ABI, functionName: "setParent", args: [sangamRegistry, label] });
  await client.waitForTransactionReceipt({ hash: parentTx });
  txs.push({ step: "setParent", tx: parentTx });
  // 3. …and the merchant's token points at it as its subregistry.
  const subTx = await wallet.writeContract({ address: sangamRegistry, abi: REGISTRY_ABI, functionName: "setSubregistry", args: [BigInt(labelhash(label)), registry] });
  await client.waitForTransactionReceipt({ hash: subTx });
  txs.push({ step: "setSubregistry", tx: subTx });
  log(`  registry ${registry}`);
  return { registry, txs };
}

function merchantLabel(merchantName: string): string {
  const suffix = `.${parentName()}`;
  if (!merchantName.endsWith(suffix)) throw new Error(`${merchantName} is not under ${parentName()}`);
  const label = merchantName.slice(0, -suffix.length);
  if (label.includes(".")) throw new Error(`${merchantName} is not a merchant name`);
  return label;
}

/**
 * Publish a merchant's products on ENS: one name per product, each with the
 * product's price and the merchant's own payout records, then the product list
 * on the merchant's name. Idempotent: existing product names only get their
 * records rewritten, so re-uploading a catalogue updates prices.
 *
 * `onProgress` gets each product as it goes live, for the upload page.
 */
export async function publishProducts(
  merchantName: string,
  products: ProductInput[],
  opts: {
    buyUrl: (product: { label: string; ensName: string }) => string;
    /** The shop's public storefront, written to the shop's name as sangam.store. */
    storeUrl?: string;
    log?: Log;
    onProgress?: (done: number, total: number, current: string) => void;
  },
): Promise<{ products: Product[]; registry: Hex; txs: ProductTx[] }> {
  const log = opts.log ?? (() => undefined);
  const name = normalize(merchantName);
  const merchant = await resolveMerchant(name);
  if (merchant.status !== "verified") throw new Error(`${name} isn't verified, so it can't list products`);

  const rows: Product[] = products.map((p) => {
    const label = productLabel(p.title);
    if (!validLabel(label)) throw new Error(`"${p.title}" doesn't make a valid name (${label})`);
    if (!Number.isInteger(p.priceInrPaise) || p.priceInrPaise <= 0) throw new Error(`"${p.title}": price must be a positive amount`);
    return { ...p, label, ensName: `${label}.${name}`, merchant: name };
  });
  const dupes = rows.map((r) => r.label).filter((l, i, all) => all.indexOf(l) !== i);
  if (dupes.length) throw new Error(`two products would share a name: ${[...new Set(dupes)].join(", ")}`);

  const { registry, txs } = await ensureMerchantRegistry(name, log);
  const client = sepoliaClient();
  const wallet = sangamWallet();
  const { resolver } = sangamContracts();
  const parentLabel = parentName().split(".")[0]!;
  const expiry = await client.readContract({ address: ENSV2_SEPOLIA.ETHRegistry, abi: REGISTRY_ABI, functionName: "getExpiry", args: [BigInt(labelhash(parentLabel))] });

  // 1. One token per product in the merchant's registry (skipped when it exists).
  for (const [i, p] of rows.entries()) {
    opts.onProgress?.(i, rows.length, p.ensName);
    const current = await client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getResolver", args: [p.label] });
    if (current !== ZERO) continue;
    log(`registering ${p.ensName}…`);
    const tx = await wallet.writeContract({ address: registry, abi: REGISTRY_ABI, functionName: "register", args: [p.label, wallet.account.address, ZERO, resolver, PRODUCT_ROLES, expiry] });
    await client.waitForTransactionReceipt({ hash: tx });
    txs.push({ step: `register ${p.label}`, tx });
  }

  // 2. Records: every product's, plus the product list on the merchant, batched
  // into multicalls of ~12 products so no transaction gets too big.
  const recordCalls = (p: Product) => {
    const n = dns(p.ensName);
    const set = (key: string, value: string) => encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [n, key, value] });
    return [
      set(MERCHANT_TEXT_KEYS.endpoint, opts.buyUrl(p)),
      set(MERCHANT_TEXT_KEYS.hederaPayTo, merchant.hederaPayTo),
      set(MERCHANT_TEXT_KEYS.network, merchant.network),
      set(MERCHANT_TEXT_KEYS.priceInrPaise, String(p.priceInrPaise)),
      set(MERCHANT_TEXT_KEYS.upiHandle, merchant.upiHandle),
      set(STATUS_TEXT_KEY, "verified"),
      // The shop's deposit address as the product's standard address record, so a wallet can pay the product by name.
      ...(merchant.evmPayTo
        ? EVM_COIN_TYPES.map((coinType) => encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setAddress", args: [n, coinType, merchant.evmPayTo as `0x${string}`] }))
        : []),
      set(PRODUCT_TEXT_KEYS.merchant, name),
      set(PRODUCT_TEXT_KEYS.title, p.title),
      set(PRODUCT_TEXT_KEYS.description, p.description ?? ""),
      set(PRODUCT_TEXT_KEYS.image, p.image ?? ""),
    ];
  };
  const listCall = encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [dns(name), PRODUCTS_TEXT_KEY, rows.map((r) => r.label).join(",")] });
  const batches: `0x${string}`[][] = [];
  for (let i = 0; i < rows.length; i += 12) batches.push(rows.slice(i, i + 12).flatMap(recordCalls));
  if (batches.length === 0) batches.push([]);
  batches[batches.length - 1]!.push(listCall);
  if (opts.storeUrl) {
    batches[batches.length - 1]!.push(encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [dns(name), STORE_TEXT_KEY, opts.storeUrl] }));
  }
  for (const [i, calls] of batches.entries()) {
    log(`writing records ${i + 1}/${batches.length}…`);
    const tx = await wallet.writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: "multicall", args: [calls] });
    await client.waitForTransactionReceipt({ hash: tx });
    txs.push({ step: `records ${i + 1}/${batches.length}`, tx });
  }
  opts.onProgress?.(rows.length, rows.length, "");
  for (const r of rows) forgetMerchant(r.ensName);
  forgetMerchant(name);
  return { products: rows, registry, txs };
}

/** A product's display records (its price and payout records come from resolveMerchant). */
export async function readProductInfo(productName: string): Promise<{ merchant: string; title: string; description: string; image: string }> {
  const client = sepoliaClient();
  const name = normalize(productName);
  const [merchant, title, description, image] = await Promise.all(
    [PRODUCT_TEXT_KEYS.merchant, PRODUCT_TEXT_KEYS.title, PRODUCT_TEXT_KEYS.description, PRODUCT_TEXT_KEYS.image].map((key) =>
      client.getEnsText({ name, key }).then((v) => v ?? ""),
    ),
  );
  return { merchant: merchant!, title: title!, description: description!, image: image! };
}

/** The merchant's product labels, from its sangam.products record. */
export async function readProductList(merchantName: string): Promise<string[]> {
  const v = await sepoliaClient().getEnsText({ name: normalize(merchantName), key: PRODUCTS_TEXT_KEY });
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
