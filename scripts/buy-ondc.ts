// The buyer agent, buying real-shaped ONDC goods through Sangam with USDC.
// No approval step per payment. Needs `npm run web` running.
//   npm run buy-ondc -- [query] [qty]      e.g. npm run buy-ondc -- atta 1
import { createPayingFetch, hashscanTxUrl } from "@sangam/hedera";
import { envOr, formatUsdc } from "@sangam/shared";

const q = process.argv[2] ?? "atta";
const qty = process.argv[3] ?? "1";
const base = envOr("SANGAM_API_URL", "http://localhost:5173");

console.log(`[agent] searching ONDC via Sangam for "${q}"…`);
const catalog = (await (await fetch(`${base}/merchant/ondc/catalog?q=${encodeURIComponent(q)}`)).json()) as {
  results?: { name: string; priceInr: number; provider: { name: string }; ensName: string; orderUrl: string }[];
  error?: string;
};
const hit = catalog.results?.[0];
if (!hit) throw new Error(catalog.error ?? `nothing on ONDC matches "${q}"`);
console.log(`[agent] found ${hit.name} at ₹${hit.priceInr} from ${hit.provider.name} (${hit.ensName})`);

const url = new URL(hit.orderUrl);
url.searchParams.set("qty", qty);
const { buy } = createPayingFetch();
const t = Date.now();
const p = await buy<{ ondc?: { orderId: string; state: string; quoteInrPaise: number }; error?: string }>(url);
if (!p.settle?.success) throw new Error(`purchase failed (${p.status}): ${JSON.stringify(p.body)}`);

console.log(`[agent] paid ${formatUsdc(p.price)} USDC in ${((Date.now() - t) / 1000).toFixed(1)}s, no approval step`);
console.log(`[agent] ONDC order ${p.body.ondc?.orderId} · ${p.body.ondc?.state} · ₹${(p.body.ondc?.quoteInrPaise ?? 0) / 100} incl. delivery`);
console.log(`        ${hashscanTxUrl(p.settle.transaction)}`);
