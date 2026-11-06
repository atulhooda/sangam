import "server-only";
import { encodeFunctionData, type Hex } from "viem";
import { RESOLVER_ABI, publishProducts, readProductInfo, readProductList, resolveMerchant, sepoliaClient, stampProducts, type ProductInput } from "@sangam/ens";
import { inrPerUsd, paiseToUsdcAtomic } from "@sangam/shared";
import { sangamApiUrl } from "./merchant";

/*
 * A verified merchant's catalogue. The merchant uploads products in bulk
 * (CSV); Sangam gives each one its own ENS name under the merchant's
 * (truffle-cake.bakery.sangam.eth) carrying its price and the merchant's payout
 * accounts, and the storefront at /store/<merchant> is rebuilt from ENS alone.
 * Publishing takes a few Sepolia transactions, so it runs as a background job
 * the upload page polls.
 */

export const MAX_PRODUCTS = 40;

/** Where agents buy a product: its own x402 paywall (both rails). Published as the product's ENS url. */
export const productBuyUrl = (merchant: string, label: string) =>
  `${sangamApiUrl().replace(/\/+$/, "")}/store/${encodeURIComponent(merchant)}/${encodeURIComponent(label)}/buy`;

export { parseProductCsv, type ParsedRow } from "../products-csv";

/** The shop's public storefront (its menu), shareable and written to its ENS name. */
export const storeUrl = (merchant: string) => `${sangamApiUrl().replace(/\/+$/, "")}/store/${encodeURIComponent(merchant)}`;

/* ── publishing jobs ── */

export type PublishJob = {
  merchant: string;
  /** "needs-signature": an owned shop's records are ready for its wallet to sign (see `sign`). */
  state: "running" | "needs-signature" | "done" | "failed";
  /** Owned shops: the record writes for the shop's wallet, one transaction each. */
  sign?: { from: string; to: string; data: string[] };
  /** Owned shops: the product names to stamp verified once the wallet has signed. */
  pendingNames?: string[];
  done: number;
  total: number;
  current: string;
  log: string[];
  txs: { step: string; tx: string }[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

const g = globalThis as unknown as { __sangamProductJobs?: Map<string, PublishJob> };
const jobs = (g.__sangamProductJobs ??= new Map());

export const productJob = (merchant: string) => jobs.get(merchant) ?? null;

/** Start publishing a catalogue on ENS. One job per merchant at a time. `owned`: the shop owns its name (its wallet signs the records). */
export function startPublish(merchant: string, products: ProductInput[], owned?: { owner: string; resolver: string }): PublishJob {
  const running = jobs.get(merchant);
  if (running?.state === "running" || running?.state === "needs-signature") throw new Error("Your products are still being published; finish that first.");
  const job: PublishJob = {
    merchant,
    state: "running",
    done: 0,
    total: products.length,
    current: "",
    log: [],
    txs: [],
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(merchant, job);
  void publishProducts(merchant, products, {
    buyUrl: (p) => productBuyUrl(merchant, p.label),
    storeUrl: storeUrl(merchant),
    log: (m) => job.log.push(m),
    onProgress: (done, total, current) => Object.assign(job, { done, total, current }),
    ...(owned ? { ownedResolver: owned.resolver as Hex } : {}),
  })
    .then((r) => {
      if (owned && r.unsigned) {
        Object.assign(job, {
          state: "needs-signature",
          current: "",
          txs: r.txs,
          sign: { from: owned.owner, to: r.resolver, data: r.unsigned.map((calls) => encodeFunctionData({ abi: RESOLVER_ABI, functionName: "multicall", args: [calls] })) },
          pendingNames: r.products.map((p) => p.ensName),
        });
        return;
      }
      Object.assign(job, { state: "done", done: job.total, current: "", txs: r.txs, finishedAt: new Date().toISOString() });
      storeCache.delete(merchant);
    })
    .catch((err: Error) => {
      Object.assign(job, { state: "failed", error: err.message.split("\n")[0]!.slice(0, 300), finishedAt: new Date().toISOString() });
      console.error(`[products] ${merchant}: ${err.message}`);
    });
  return job;
}

/**
 * Owned shops: the wallet sent the record transactions. Check each one on
 * chain (succeeded, sent to the shop's resolver), then Sangam stamps the new
 * products verified, its one remaining right.
 */
export async function confirmPublish(merchant: string, txHashes: string[]): Promise<PublishJob> {
  const job = jobs.get(merchant);
  if (!job || job.state !== "needs-signature" || !job.sign) throw new Error("There's nothing waiting for your signature.");
  if (txHashes.length !== job.sign.data.length) throw new Error(`Expected ${job.sign.data.length} signed transactions, got ${txHashes.length}.`);
  const client = sepoliaClient();
  for (const hash of txHashes) {
    const r = await client.waitForTransactionReceipt({ hash: hash as Hex, timeout: 60_000 });
    if (r.status !== "success" || r.to?.toLowerCase() !== job.sign.to.toLowerCase()) throw new Error(`${hash} didn't write your shop's records`);
    job.txs.push({ step: "records (your wallet)", tx: hash });
  }
  const stamp = await stampProducts(job.sign.to as Hex, job.pendingNames ?? []);
  job.txs.push({ step: "verified stamp (Sangam)", tx: stamp });
  Object.assign(job, { state: "done", done: job.total, sign: undefined, pendingNames: undefined, finishedAt: new Date().toISOString() });
  storeCache.delete(merchant);
  return job;
}

/* ── storefront, read from ENS ── */

export type StoreProduct = {
  label: string;
  ensName: string;
  title: string;
  description: string;
  image: string;
  priceInrPaise: number;
  priceUsdcAtomic: string;
  buyUrl: string;
  /** "hedera": an agent over x402. "sepolia": from the buyer's own MetaMask, to the name's address record. */
  rails: ("hedera" | "sepolia")[];
};

export type Storefront = {
  merchant: string;
  status: string | null;
  upiHandle: string;
  products: StoreProduct[];
  errors: string[];
};

const storeCache = new Map<string, { at: number; value: Storefront }>();

/** The merchant's storefront, rebuilt from ENS (product list on the merchant's name, then each product's records). */
export async function storefront(merchant: string): Promise<Storefront> {
  const hit = storeCache.get(merchant);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  const record = await resolveMerchant(merchant);
  const labels = await readProductList(merchant);
  const rate = await inrPerUsd();
  const errors: string[] = [];
  const products = (
    await Promise.all(
      labels.map(async (label): Promise<StoreProduct | null> => {
        const ensName = `${label}.${merchant}`;
        try {
          const [rec, info] = await Promise.all([resolveMerchant(ensName), readProductInfo(ensName)]);
          return {
            label,
            ensName,
            title: info.title || label,
            description: info.description,
            image: info.image,
            priceInrPaise: rec.priceInrPaise,
            priceUsdcAtomic: paiseToUsdcAtomic(rec.priceInrPaise, rate).toString(),
            buyUrl: rec.endpoint,
            rails: rec.evmPayTo ? ["hedera", "sepolia"] : ["hedera"],
          };
        } catch (err) {
          errors.push(`${ensName}: ${(err as Error).message.split("\n")[0]}`);
          return null;
        }
      }),
    )
  ).filter((p): p is StoreProduct => p !== null);
  const value: Storefront = { merchant, status: record.status ?? null, upiHandle: record.upiHandle, products, errors };
  storeCache.set(merchant, { at: Date.now(), value });
  return value;
}
