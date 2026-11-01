import "server-only";
import { bppId, bppUri, ondcLabel, rupeesToPaise, select, type Line, type Order } from "@sangam/ondc";
import { parentName } from "@sangam/ens";

/*
 * Sangam's ONDC storefront for agents. An agent can't speak ONDC, so Sangam
 * does it for them: it searches and quotes over ONDC, takes the USDC over
 * x402, then confirms the order with the seller and settles the seller in INR
 * (ONDC's "buyer app collects payment" model).
 */

/** The seller app Sangam talks to. On the real network this comes from the gateway's on_search. */
export const sellerApp = () => ({ bppId: bppId(), bppUri: bppUri() });

export const ondcMerchantName = (providerId: string) => `${ondcLabel(providerId)}.${parentName()}`;

export type HeldQuote = { line: Line; transactionId: string; order: Order; quotePaise: number; at: number };

const QUOTE_TTL_MS = 10 * 60_000;
const g = globalThis as unknown as { __sangamOndcQuotes?: Map<string, HeldQuote> };
const quotes = (g.__sangamOndcQuotes ??= new Map());

const key = (l: Line) => `${l.providerId}:${l.itemId}:${l.count}`;

/**
 * The seller's binding quote (ONDC select) for this line. Held for 10
 * minutes so the 402 and the paid retry see the same price and the same
 * ONDC transaction.
 */
export async function quoteFor(line: Line): Promise<HeldQuote> {
  const hit = quotes.get(key(line));
  if (hit && Date.now() - hit.at < QUOTE_TTL_MS) return hit;
  const { transactionId, order } = await select(line, sellerApp());
  if (!order.quote) throw new Error("seller's on_select had no quote");
  const held = { line, transactionId, order, quotePaise: rupeesToPaise(order.quote.price.value), at: Date.now() };
  quotes.set(key(line), held);
  return held;
}

/** After an order is confirmed, the next order for the same line starts a new ONDC transaction. */
export const releaseQuote = (line: Line) => quotes.delete(key(line));

export function parseLine(params: URLSearchParams, providerId: string): Line | { error: string } {
  const itemId = params.get("item");
  const count = Number(params.get("qty") ?? "1");
  if (!itemId) return { error: "missing ?item=<ONDC item id> (see /merchant/ondc/catalog)" };
  if (!Number.isInteger(count) || count < 1 || count > 50) return { error: "qty must be a whole number from 1 to 50" };
  return { providerId: params.get("provider") ?? providerId, itemId, count };
}
