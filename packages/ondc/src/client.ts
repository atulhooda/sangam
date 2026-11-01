import { publicKeyFor, bapId, bapUri, signerFor } from "./registry.ts";
import { verifyAuthorization } from "./signing.ts";
import {
  ACK,
  nack,
  newContext,
  postSigned,
  type Ack,
  type Action,
  type Envelope,
  type Item,
  type Order,
  type Provider,
} from "./protocol.ts";

/*
 * Sangam as an ONDC buyer app (BAP). ONDC is asynchronous: the BAP POSTs
 * /<action> to the seller app, gets an immediate ACK, and the real answer
 * arrives later as a signed POST to the BAP's /on_<action>. send() does the
 * POST and then waits for the matching callback (same message_id), which
 * the app's /ondc/[action] route hands to receiveCallback().
 */

type Waiter = { resolve: (e: Envelope) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
const g = globalThis as unknown as { __sangamOndcWaiters?: Map<string, Waiter>; __sangamOndcLog?: Envelope[] };
const waiters = (g.__sangamOndcWaiters ??= new Map());
const log = (g.__sangamOndcLog ??= []);

const CALLBACK_TIMEOUT_MS = 15_000;

/** Called by the /ondc/on_<action> route. Verifies the seller's signature, then wakes send(). */
export async function receiveCallback(action: string, rawBody: string, authorization: string | null): Promise<Ack> {
  const auth = await verifyAuthorization(rawBody, authorization, publicKeyFor);
  if (!auth.ok) return nack(`signature check failed: ${auth.reason}`, "10002");
  let env: Envelope;
  try {
    env = JSON.parse(rawBody) as Envelope;
  } catch {
    return nack("body is not JSON");
  }
  if (env.context?.action !== action) return nack(`context.action ${env.context?.action} does not match /${action}`);
  if (env.context.bpp_id !== auth.subscriberId) return nack("signer is not the context's bpp_id", "10002");

  log.push(env);
  if (log.length > 200) log.shift();
  const w = waiters.get(env.context.message_id);
  if (w) {
    clearTimeout(w.timer);
    waiters.delete(env.context.message_id);
    if (env.error) w.reject(new Error(`ONDC ${action}: ${env.error.code} ${env.error.message}`));
    else w.resolve(env);
  }
  return ACK;
}

type Target = { bppId: string; bppUri: string };

async function send<M>(action: Action, target: Target, message: unknown, transactionId?: string): Promise<Envelope<M>> {
  const context = newContext({ action, bapId: bapId(), bapUri: bapUri(), bppId: target.bppId, bppUri: target.bppUri, transactionId });
  const answer = new Promise<Envelope>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(context.message_id);
      reject(new Error(`ONDC ${action}: no on_${action} from ${target.bppId} within ${CALLBACK_TIMEOUT_MS / 1000}s`));
    }, CALLBACK_TIMEOUT_MS);
    waiters.set(context.message_id, { resolve, reject, timer });
  });
  const ack = await postSigned(`${target.bppUri}/${action}`, { context, message }, signerFor(bapId())).catch((err: Error) => {
    const w = waiters.get(context.message_id);
    if (w) clearTimeout(w.timer);
    waiters.delete(context.message_id);
    throw err;
  });
  if (ack.message.ack.status !== "ACK") {
    const w = waiters.get(context.message_id);
    if (w) clearTimeout(w.timer);
    waiters.delete(context.message_id);
    throw new Error(`ONDC ${action} NACK from ${target.bppId}: ${ack.error?.message ?? "no reason"}`);
  }
  return (await answer) as Envelope<M>;
}

/* ── the four steps of an ONDC order ── */

export type CatalogHit = { bppId: string; bppUri: string; transactionId: string; provider: Provider; item: Item };

/**
 * search. On the real network this goes to the gateway, which fans it out to
 * every seller app; here it goes straight to the one known seller app.
 */
export async function search(query: string, target: Target): Promise<CatalogHit[]> {
  const env = await send<{ catalog: { "bpp/providers": Provider[] } }>("search", target, {
    intent: { item: { descriptor: { name: query } }, fulfillment: { type: "Delivery" }, payment: { type: "ON-ORDER" } },
  });
  return env.message.catalog["bpp/providers"].flatMap((provider) =>
    (provider.items ?? []).map((item) => ({ ...target, transactionId: env.context.transaction_id, provider: { id: provider.id, descriptor: provider.descriptor }, item })),
  );
}

export type Line = { providerId: string; itemId: string; count: number };

const orderOf = (l: Line): Order => ({ provider: { id: l.providerId }, items: [{ id: l.itemId, quantity: { selected: { count: l.count } } }] });

/** select: the seller's binding quote for these items. */
export async function select(line: Line, target: Target, transactionId?: string) {
  const env = await send<{ order: Order }>("select", target, { order: orderOf(line) }, transactionId);
  return { transactionId: env.context.transaction_id, order: env.message.order };
}

/** init: billing details in, payment terms and the seller's UPI settlement details out. */
export async function init(line: Line, target: Target, transactionId: string) {
  const env = await send<{ order: Order }>(
    "init",
    target,
    {
      order: {
        ...orderOf(line),
        billing: { name: "Sangam agent buyer", phone: "9000000000", email: "agent@sangam.local" },
        payment: { type: "ON-ORDER", collected_by: "BAP" },
      },
    },
    transactionId,
  );
  return env.message.order;
}

/** confirm: the BAP has collected payment; the seller accepts the order. */
export async function confirm(line: Line, target: Target, transactionId: string, payment: { amountPaise: number; reference: string }) {
  const env = await send<{ order: Order }>(
    "confirm",
    target,
    {
      order: {
        ...orderOf(line),
        payment: {
          type: "ON-ORDER",
          collected_by: "BAP",
          status: "PAID",
          params: { amount: (payment.amountPaise / 100).toFixed(2), currency: "INR", transaction_id: payment.reference },
        },
      },
    },
    transactionId,
  );
  return env.message.order;
}

/** Recent callbacks, newest last (for debugging and the dashboard). */
export const recentCallbacks = () => [...log];
