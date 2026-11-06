import "server-only";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeReceipt } from "@sangam/hedera";
import { DATA_DIR, mocks } from "@sangam/shared";

/*
 * Bolo Sangam invoices: a merchant speaks one, it lands here and on the HCS
 * receipt topic, and its pay link is an x402 endpoint with the SPOKEN price
 * (not the ENS list price). The buyer agent pays it through the same rails,
 * ENS checks, 0G decision and UPI payout as any other Sangam payment — only
 * the invoice's origin is a voice.
 */

export type BoloInvoice = {
  id: string;
  merchant: string;
  buyerName: string;
  /** Whole rupees, as spoken. */
  amountPaise: number;
  dueDays: number | null;
  note: string | null;
  /** What the merchant actually said. */
  transcript: string;
  createdAt: string;
  status: "issued" | "paid";
  hcsSequence: number | null;
  hcsTopicId: string | null;
  /** The settlement the payment produced, once the x402 endpoint noticed. */
  settlementTx: string | null;
};

const FILE = path.join(DATA_DIR, "bolo-invoices.json");

type StoreState = { lock: Promise<unknown> };
const g = globalThis as unknown as { __sangamBolo?: StoreState };
const state: StoreState = (g.__sangamBolo ??= { lock: Promise.resolve() });

function readAll(): BoloInvoice[] {
  if (!existsSync(FILE)) return [];
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as BoloInvoice[];
  } catch {
    return [];
  }
}

async function writeAll(items: BoloInvoice[]) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(items, null, 2));
  await rename(`${FILE}.tmp`, FILE);
}

async function withLock<T>(fn: (items: BoloInvoice[]) => T | Promise<T>): Promise<T> {
  const run = state.lock.then(async () => {
    const items = readAll();
    const result = await fn(items);
    await writeAll(items);
    return result;
  });
  state.lock = run.catch(() => undefined);
  return run;
}

export function getBoloInvoice(id: string): BoloInvoice | undefined {
  return readAll().find((i) => i.id === id);
}

export function listBoloInvoices(merchant?: string): BoloInvoice[] {
  return readAll()
    .filter((i) => !merchant || i.merchant === merchant)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type BoloInput = {
  merchant: string;
  buyerName: string;
  amountPaise: number;
  dueDays: number | null;
  note: string | null;
  transcript: string;
};

/**
 * Create the invoice and pin it to consensus. The HCS message is the
 * tamper-evident "this invoice existed, said this, at this time" record —
 * the same topic settlements are receipted to, so one chain carries the whole
 * story: spoken → issued → paid.
 */
export async function createBoloInvoice(input: BoloInput): Promise<BoloInvoice> {
  const invoice: BoloInvoice = {
    id: randomUUID(),
    merchant: input.merchant,
    buyerName: input.buyerName,
    amountPaise: input.amountPaise,
    dueDays: input.dueDays,
    note: input.note,
    transcript: input.transcript,
    createdAt: new Date().toISOString(),
    status: "issued",
    hcsSequence: null,
    hcsTopicId: null,
    settlementTx: null,
  };
  const topicId = process.env.HCS_TOPIC_ID;
  if (!mocks().hcs && topicId) {
    try {
      const { seq } = await writeReceipt(topicId, {
        type: "bolo-invoice",
        id: invoice.id,
        merchant: invoice.merchant,
        buyer: invoice.buyerName,
        inr: invoice.amountPaise,
        dueDays: invoice.dueDays,
        transcript: invoice.transcript,
        createdAt: invoice.createdAt,
      });
      invoice.hcsSequence = seq;
      invoice.hcsTopicId = topicId;
    } catch (err) {
      // The invoice is still valid without consensus; the dashboard shows the gap.
      console.error(`[bolo] HCS publish failed: ${(err as Error).message}`);
    }
  }
  return withLock((items) => {
    items.push(invoice);
    return invoice;
  });
}

export async function markBoloPaid(id: string, settlementTx: string): Promise<BoloInvoice | undefined> {
  return withLock((items) => {
    const hit = items.find((i) => i.id === id);
    if (hit) {
      hit.status = "paid";
      hit.settlementTx = settlementTx;
    }
    return hit;
  });
}

/* ── voice sessions (Ritu-style: create over HMAC, complete via callback) ── */

export type BoloVoiceSession = {
  id: string;
  role: "merchant" | "buyer";
  /** The ENS name (merchant) or label (buyer) that owns the session. */
  actor: string;
  createdAt: string;
  status: "open" | "completed" | "failed";
  /** Merchant sessions: the invoice the confirmed voice conversation produced. */
  invoiceId: string | null;
  payUrl: string | null;
  /** Buyer sessions: what they asked for ("pay" = the browser should pay on close). */
  intent: "pay" | null;
};

const SESSIONS_FILE = path.join(DATA_DIR, "bolo-sessions.json");

function readSessions(): BoloVoiceSession[] {
  if (!existsSync(SESSIONS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as BoloVoiceSession[];
  } catch {
    return [];
  }
}

async function writeSessions(items: BoloVoiceSession[]) {
  mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
  await writeFile(`${SESSIONS_FILE}.tmp`, JSON.stringify(items, null, 2));
  await rename(`${SESSIONS_FILE}.tmp`, SESSIONS_FILE);
}

export function getVoiceSession(id: string): BoloVoiceSession | undefined {
  return readSessions().find((s) => s.id === id);
}

export async function recordVoiceSession(row: {
  id: string;
  role: "merchant" | "buyer";
  actor: string;
}): Promise<BoloVoiceSession> {
  const s: BoloVoiceSession = { ...row, createdAt: new Date().toISOString(), status: "open", invoiceId: null, payUrl: null, intent: null };
  await withSessions((items) => {
    items.push(s);
    return s;
  });
  return s;
}

export async function completeVoiceSession(
  id: string,
  patch: { status: "completed" | "failed"; invoiceId?: string | null; payUrl?: string | null; intent?: "pay" | null },
): Promise<BoloVoiceSession | undefined> {
  return withSessions((items) => {
    const hit = items.find((s) => s.id === id);
    if (hit) {
      hit.status = patch.status;
      if (patch.invoiceId !== undefined) hit.invoiceId = patch.invoiceId ?? null;
      if (patch.payUrl !== undefined) hit.payUrl = patch.payUrl ?? null;
      if (patch.intent !== undefined) hit.intent = patch.intent ?? null;
    }
    return hit;
  });
}

async function withSessions<T>(fn: (items: BoloVoiceSession[]) => T | Promise<T>): Promise<T> {
  const run = state.lock.then(async () => {
    const items = readSessions();
    const result = await fn(items);
    await writeSessions(items);
    return result;
  });
  state.lock = run.catch(() => undefined);
  return run;
}
