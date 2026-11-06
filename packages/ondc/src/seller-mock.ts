import { randomUUID } from "node:crypto";
import { bppId, bppUri, publicKeyFor, signerFor } from "./registry.ts";
import { verifyAuthorization } from "./signing.ts";
import {
  ACK,
  nack,
  newContext,
  paiseToRupees,
  postSigned,
  rupeesToPaise,
  type Ack,
  type Action,
  type Envelope,
  type Item,
  type Order,
  type Quote,
} from "./protocol.ts";

/*
 * MOCK ONDC SELLER APP (BPP). Not a real ONDC participant.
 *
 * ONDC's hosted mock (mock.ondc.org) and staging registry were unreachable
 * when this was built, so this stands in for a Retail B2B seller: it verifies
 * the BAP's signature, ACKs, then sends a signed on_<action> back to the
 * context's bap_uri, exactly as a real seller app would. Catalog, prices and
 * the UPI handle are made up.
 */

export const MOCK_PROVIDER = { id: "annapurna-wholesale", descriptor: { name: "Annapurna Wholesale (mock), Pune" } };
export const MOCK_SELLER_UPI = "annapurna.wholesale@okaxis";
const DELIVERY_PAISE = 4000;

const CATALOG: Item[] = [
  { id: "atta-10kg", descriptor: { name: "Chakki atta, 10 kg" }, price: { currency: "INR", value: "420.00" }, quantity: { unitized: { measure: { unit: "kilogram", value: "10" } } } },
  { id: "basmati-5kg", descriptor: { name: "Basmati rice, 5 kg" }, price: { currency: "INR", value: "550.00" }, quantity: { unitized: { measure: { unit: "kilogram", value: "5" } } } },
  { id: "toor-dal-1kg", descriptor: { name: "Toor dal, 1 kg" }, price: { currency: "INR", value: "160.00" }, quantity: { unitized: { measure: { unit: "kilogram", value: "1" } } } },
  { id: "ghee-1l", descriptor: { name: "Cow ghee, 1 litre" }, price: { currency: "INR", value: "620.00" }, quantity: { unitized: { measure: { unit: "litre", value: "1" } } } },
];

const ACTIONS: Action[] = ["search", "select", "init", "confirm", "status"];

const g = globalThis as unknown as { __sangamMockOrders?: Map<string, Order> };
const orders = (g.__sangamMockOrders ??= new Map());

type Reply = { message?: unknown; error?: { type: string; code: string; message: string } };

/**
 * Handle one incoming ONDC action. Returns the sync ACK/NACK and, when
 * ACKed, a function that sends the async on_<action> (run it after
 * responding, e.g. in Next's after()).
 */
export async function handleSellerAction(action: string, rawBody: string, authorization: string | null): Promise<{ ack: Ack; reply?: () => Promise<void> }> {
  if (!ACTIONS.includes(action as Action)) return { ack: nack(`unsupported action ${action}`, "10003") };
  const auth = await verifyAuthorization(rawBody, authorization, publicKeyFor);
  if (!auth.ok) return { ack: nack(`signature check failed: ${auth.reason}`, "10002") };

  const env = JSON.parse(rawBody) as Envelope<{ order?: Order; intent?: { item?: { descriptor?: { name?: string } } } }>;
  if (env.context.bap_id !== auth.subscriberId) return { ack: nack("signer is not the context's bap_id", "10002") };

  const answer = respond(action as Action, env);
  const reply = async () => {
    const context = newContext({
      action: `on_${action as Action}`,
      bapId: env.context.bap_id,
      bapUri: env.context.bap_uri,
      bppId: bppId(),
      bppUri: bppUri(),
      transactionId: env.context.transaction_id,
      messageId: env.context.message_id,
    });
    await postSigned(`${env.context.bap_uri}/on_${action}`, { context, ...answer } as Envelope, signerFor(bppId())).catch((err: Error) =>
      console.error(`[ondc-seller] on_${action} delivery failed: ${err.message}`),
    );
  };
  return { ack: ACK, reply };
}

function respond(action: Action, env: Envelope<{ order?: Order; intent?: { item?: { descriptor?: { name?: string } } } }>): Reply {
  if (action === "search") {
    const q = (env.message.intent?.item?.descriptor?.name ?? "").toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);
    const items = CATALOG.filter((i) => words.length === 0 || words.some((w) => i.descriptor.name.toLowerCase().includes(w) || i.id.includes(w)));
    return { message: { catalog: { "bpp/descriptor": { name: "Annapurna seller app (mock)" }, "bpp/providers": [{ ...MOCK_PROVIDER, items }] } } };
  }

  const order = env.message.order;
  const line = order?.items?.[0];
  const item = CATALOG.find((i) => i.id === line?.id);
  if (!order || order.provider?.id !== MOCK_PROVIDER.id || !line || !item) {
    return { error: { type: "DOMAIN-ERROR", code: "40002", message: "item not found with this provider" } };
  }
  const count = Math.max(1, Math.min(50, Math.floor(line.quantity?.selected?.count ?? 1)));
  const quote = quoteFor(item, count);
  const base: Order = { provider: MOCK_PROVIDER, items: [{ id: item.id, quantity: { selected: { count } } }], quote };

  if (action === "select") return { message: { order: base } };

  if (action === "init") {
    return {
      message: {
        order: {
          ...base,
          billing: order.billing,
          payment: {
            type: "ON-ORDER",
            collected_by: "BAP",
            status: "NOT-PAID",
            params: { amount: quote.price.value, currency: "INR" },
            "@ondc/org/settlement_details": [
              { settlement_counterparty: "seller-app", settlement_type: "upi", upi_address: MOCK_SELLER_UPI, beneficiary_name: MOCK_PROVIDER.descriptor.name },
            ],
          },
        },
      },
    };
  }

  if (action === "confirm") {
    const paid = order.payment?.status === "PAID" && rupeesToPaise(order.payment.params?.amount ?? "0") >= rupeesToPaise(quote.price.value);
    if (!paid) return { error: { type: "DOMAIN-ERROR", code: "40003", message: `payment missing or below quote ₹${quote.price.value}` } };
    const confirmed: Order = {
      ...base,
      id: `ANP-${randomUUID().slice(0, 8).toUpperCase()}`,
      state: "Accepted",
      payment: { ...order.payment!, "@ondc/org/settlement_details": [{ settlement_counterparty: "seller-app", settlement_type: "upi", upi_address: MOCK_SELLER_UPI, beneficiary_name: MOCK_PROVIDER.descriptor.name }] },
      created_at: new Date().toISOString(),
    };
    orders.set(env.context.transaction_id, confirmed);
    return { message: { order: confirmed } };
  }

  // status
  const known = orders.get(env.context.transaction_id);
  return known ? { message: { order: known } } : { error: { type: "DOMAIN-ERROR", code: "40004", message: "no order for this transaction" } };
}

function quoteFor(item: Item, count: number): Quote {
  const itemsPaise = rupeesToPaise(item.price.value) * count;
  return {
    price: { currency: "INR", value: paiseToRupees(itemsPaise + DELIVERY_PAISE) },
    breakup: [
      { "@ondc/org/item_id": item.id, "@ondc/org/title_type": "item", title: `${item.descriptor.name} × ${count}`, price: { currency: "INR", value: paiseToRupees(itemsPaise) } },
      { "@ondc/org/item_id": item.id, "@ondc/org/title_type": "delivery", title: "Delivery charges", price: { currency: "INR", value: paiseToRupees(DELIVERY_PAISE) } },
    ],
    ttl: "PT15M",
  };
}
