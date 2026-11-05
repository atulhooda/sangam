import { randomUUID } from "node:crypto";
import { authorizationHeader, type Signer } from "./signing.ts";
import { ONDC_CITY, ONDC_DOMAIN, ONDC_VERSION } from "./registry.ts";

/** ONDC Retail B2B 2.0.2 shapes, trimmed to the fields Sangam reads or sends. */

export type Action = "search" | "select" | "init" | "confirm" | "status";
export type OnAction = `on_${Action}`;

export type Context = {
  domain: string;
  location: { city: { code: string }; country: { code: string } };
  action: Action | OnAction;
  version: string;
  bap_id: string;
  bap_uri: string;
  bpp_id?: string;
  bpp_uri?: string;
  transaction_id: string;
  message_id: string;
  timestamp: string;
  ttl: string;
};

export type Price = { currency: "INR"; value: string };
export type Item = {
  id: string;
  descriptor: { name: string; short_desc?: string };
  price: Price;
  quantity?: { unitized?: { measure: { unit: string; value: string } }; selected?: { count: number } };
};
export type Provider = { id: string; descriptor: { name: string }; items?: Item[] };
export type Quote = {
  price: Price;
  breakup: { "@ondc/org/item_id": string; "@ondc/org/title_type": "item" | "delivery"; title: string; price: Price }[];
  ttl: string;
};
export type SettlementDetail = {
  settlement_counterparty: "seller-app";
  settlement_type: "upi";
  upi_address: string;
  beneficiary_name: string;
};
export type Payment = {
  type: "ON-ORDER";
  collected_by: "BAP" | "BPP";
  status?: "PAID" | "NOT-PAID";
  params?: { amount: string; currency: "INR"; transaction_id?: string };
  "@ondc/org/settlement_details"?: SettlementDetail[];
};
export type Order = {
  id?: string;
  state?: "Created" | "Accepted" | "In-progress" | "Completed" | "Cancelled";
  provider: { id: string; descriptor?: { name: string } };
  items: { id: string; quantity: { selected: { count: number } } }[];
  quote?: Quote;
  payment?: Payment;
  billing?: { name: string; phone: string; email?: string; address?: string };
  created_at?: string;
};

export type OndcError = { type: string; code: string; message: string };
export type Envelope<M = unknown> = { context: Context; message: M; error?: OndcError };
export type Ack = { message: { ack: { status: "ACK" | "NACK" } }; error?: OndcError };

export const ACK: Ack = { message: { ack: { status: "ACK" } } };
export const nack = (message: string, code = "10001"): Ack => ({ message: { ack: { status: "NACK" } }, error: { type: "CONTEXT-ERROR", code, message } });

export function newContext(p: { action: Action | OnAction; bapId: string; bapUri: string; bppId?: string; bppUri?: string; transactionId?: string; messageId?: string }): Context {
  return {
    domain: ONDC_DOMAIN,
    location: { city: { code: ONDC_CITY }, country: { code: "IND" } },
    action: p.action,
    version: ONDC_VERSION,
    bap_id: p.bapId,
    bap_uri: p.bapUri,
    ...(p.bppId ? { bpp_id: p.bppId, bpp_uri: p.bppUri } : {}),
    transaction_id: p.transactionId ?? randomUUID(),
    message_id: p.messageId ?? randomUUID(),
    timestamp: new Date().toISOString(),
    ttl: "PT30S",
  };
}

/** POST a signed ONDC message and return the synchronous ACK/NACK. */
export async function postSigned(url: string, envelope: Envelope, signer: Signer): Promise<Ack> {
  const body = JSON.stringify(envelope);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authorizationHeader(body, signer) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const ack = (await res.json().catch(() => null)) as Ack | null;
  if (!ack?.message?.ack) throw new Error(`${url} answered ${res.status} without an ONDC ACK`);
  return ack;
}

export const rupeesToPaise = (value: string) => Math.round(Number(value) * 100);
export const paiseToRupees = (paise: number) => (paise / 100).toFixed(2);
