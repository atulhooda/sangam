import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@sangam/shared";
import { mirrorNodeUrl } from "./client.ts";

/*
 * Hash-chained HCS receipts. Each receipt on the topic carries `prev`: the
 * sequence number and hash of the receipt before it. hash(N) = sha256 of the
 * canonical JSON of receipt N's payload plus its own consensus sequence
 * number (known only after HCS assigns it). Someone with only the Mirror
 * Node — no access to Sangam's files — can replay the topic and check that
 * every receipt links to the one before it, so Sangam cannot quietly drop or
 * reorder a settlement it already published.
 */

export type ChainHead = { topicId: string; seq: number; hash: string } | null;

const CHAIN_FILE = path.join(DATA_DIR, "hcs-chain.local.json");

/** Deterministic JSON: object keys sorted recursively, so hashing is stable. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** sha256 hex of a receipt's payload with its consensus sequence number injected. */
export function hashReceiptMessage(msg: Record<string, unknown> & { seq?: number }): string {
  const { seq, ...rest } = msg;
  return createHash("sha256").update(canonicalJson({ ...rest, seq })).digest("hex");
}

function readHeadFile(): ChainHead {
  if (!existsSync(CHAIN_FILE)) return null;
  try {
    const head = JSON.parse(readFileSync(CHAIN_FILE, "utf8")) as ChainHead;
    return head && head.topicId && head.seq >= 1 && typeof head.hash === "string" ? head : null;
  } catch {
    return null;
  }
}

/** Persist the chain tip after a successful write (the writer calls this). */
export async function saveChainHead(head: NonNullable<ChainHead>): Promise<void> {
  writeFileSync(CHAIN_FILE, JSON.stringify(head, null, 2));
}

/**
 * The chain tip: our saved head, or — when we've never written to this topic
 * in this process (fresh deploy, existing topic) — the topic's latest
 * message from the Mirror Node. Null when the topic is empty.
 */
export async function readChainHead(topicId: string): Promise<ChainHead> {
  const saved = readHeadFile();
  if (saved && saved.topicId === topicId) return saved;
  const res = await fetch(`${mirrorNodeUrl()}/api/v1/topics/${topicId}/messages?limit=1&order=desc`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null; // 404: empty topic; start a new chain
  const body = (await res.json()) as { messages?: { sequence_number: number; message: string }[] };
  const last = body.messages?.[0];
  if (!last) return null;
  const payload = JSON.parse(Buffer.from(last.message, "base64").toString("utf8")) as Record<string, unknown>;
  return { topicId, seq: last.sequence_number, hash: hashReceiptMessage({ ...payload, seq: last.sequence_number }) };
}

export type ChainVerification = {
  topicId: string;
  /** Messages the mirror node holds for this topic. */
  length: number;
  /** Every sangam receipt's prev link checks out against the one before it. */
  intact: boolean;
  /** Sequence number of the first receipt whose prev link doesn't match. */
  brokenAtSeq: number | null;
  head: { seq: number; hash: string } | null;
  /** True when a settled row has a newer receipt than the mirror shows yet. */
  lagging: boolean;
  error: string | null;
};

type TopicMessage = { sequence_number: number; message: string };

/**
 * Rebuild and verify the chain from the Mirror Node alone. Receipts written
 * before the chain format shipped (no `prev` field) count as genesis.
 */
export async function verifyReceiptChain(topicId: string, opts: { headSeq?: number | null } = {}): Promise<ChainVerification> {
  const out: ChainVerification = { topicId, length: 0, intact: true, brokenAtSeq: null, head: null, lagging: false, error: null };
  try {
    const messages: TopicMessage[] = [];
    let url: string | null = `${mirrorNodeUrl()}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;
    for (let page = 0; page < 100 && url; page++) {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`mirror node returned ${res.status}`);
      const body = (await res.json()) as { messages: TopicMessage[]; links?: { next?: string | null } };
      messages.push(...body.messages);
      url = body.links?.next ? new URL(body.links.next, mirrorNodeUrl()).toString() : null;
    }
    out.length = messages.length;
    if (opts.headSeq != null && (messages.at(-1)?.sequence_number ?? 0) < opts.headSeq) out.lagging = true;

    let prevPayload: (Record<string, unknown> & { seq?: number }) | null = null;
    let prevSeq: number | null = null;
    for (const m of messages) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(Buffer.from(m.message, "base64").toString("utf8")) as Record<string, unknown>;
      } catch {
        continue; // a topic can carry other messages; only chain sangam receipts
      }
      if (payload.v !== 1 || payload.kind !== "sangam.settlement") continue;
      const seq = m.sequence_number;
      const prev = payload.prev as { seq: number; hash: string } | null | undefined;
      if (prev) {
        // Verify against the previous receipt as the mirror node holds it —
        // not against anything Sangam saved.
        if (!prevPayload) {
          out.intact = false;
          out.brokenAtSeq = seq;
          break;
        }
        const expectedHash = hashReceiptMessage({ ...prevPayload, seq: prevSeq! });
        if (prev.seq !== prevSeq || prev.hash !== expectedHash) {
          out.intact = false;
          out.brokenAtSeq = seq;
          break;
        }
      }
      prevPayload = payload;
      prevSeq = seq;
      out.head = { seq, hash: hashReceiptMessage({ ...payload, seq }) };
    }
  } catch (err) {
    out.error = (err as Error).message;
    out.intact = false;
  }
  return out;
}
