import "server-only";
import { publishProducts, readProductInfo, readProductList, resolveMerchant, type ProductInput } from "@sangam/ens";
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

/* ── publishing jobs ── */

export type PublishJob = {
  merchant: string;
  state: "running" | "done" | "failed";
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

/** Start publishing a catalogue on ENS. One job per merchant at a time. */
export function startPublish(merchant: string, products: ProductInput[]): PublishJob {
  const running = jobs.get(merchant);
  if (running?.state === "running") throw new Error("Your products are still being published; wait for that to finish.");
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
    log: (m) => job.log.push(m),
    onProgress: (done, total, current) => Object.assign(job, { done, total, current }),
  })
    .then((r) => {
      Object.assign(job, { state: "done", done: job.total, current: "", txs: r.txs, finishedAt: new Date().toISOString() });
      storeCache.delete(merchant);
    })
    .catch((err: Error) => {
      Object.assign(job, { state: "failed", error: err.message.split("\n")[0]!.slice(0, 300), finishedAt: new Date().toISOString() });
      console.error(`[products] ${merchant}: ${err.message}`);
    });
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
  rails: ("hedera" | "whitechain")[];
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
            rails: rec.whitechainPayTo ? ["hedera", "whitechain"] : ["hedera"],
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
