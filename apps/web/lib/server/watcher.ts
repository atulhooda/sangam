import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mirrorNodeUrl, usdcTokenId } from "@sangam/hedera";
import { DATA_DIR, inrPerUsd, usdcAtomicToPaise } from "@sangam/shared";
import { listDepositAccounts } from "./identity";
import { DuplicateSettlementError, acceptNotice, runPipeline } from "./pipeline";
import { findByTx } from "./store";

/*
 * "Send to a name, the merchant gets rupees." Every merchant has its own
 * Hedera deposit account (its ENS sangam.payTo). This watcher reads each one
 * from the Mirror Node and turns any USDC that lands there, from an x402
 * purchase or a plain wallet transfer, into a settlement: the same pipeline
 * (chain check, 0G decision, UPI payout, HCS receipt) as a merchant's notice.
 *
 * x402 purchases also send a notice; the watcher waits 30 s before claiming a
 * transfer so the notice wins, and the Hedera tx id dedupes the rest.
 */

const CURSOR_FILE = path.join(DATA_DIR, "watcher.local.json");
const NOTICE_GRACE_S = 30;

type MirrorTx = {
  transaction_id: string;
  consensus_timestamp: string;
  result: string;
  token_transfers?: { token_id: string; account: string; amount: number }[];
};

/** Mirror "0.0.5-1700000000-123456789" → SDK "0.0.5@1700000000.123456789", the form settlements use. */
export function fromMirrorTxId(id: string): string {
  const m = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/.exec(id);
  return m ? `${m[1]}@${m[2]}.${m[3]}` : id;
}

function readCursors(): Record<string, string> {
  try {
    return existsSync(CURSOR_FILE) ? (JSON.parse(readFileSync(CURSOR_FILE, "utf8")) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeCursors(c: Record<string, string>) {
  mkdirSync(path.dirname(CURSOR_FILE), { recursive: true });
  writeFileSync(CURSOR_FILE, JSON.stringify(c, null, 2));
}

async function mirror<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${mirrorNodeUrl()}${pathAndQuery}`, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`mirror node ${res.status}`);
  return (await res.json()) as T;
}

/** Just before the account existed, as a Mirror Node timestamp. */
async function createdAt(accountId: string): Promise<string> {
  const a = await mirror<{ created_timestamp: string }>(`/api/v1/accounts/${accountId}`);
  const [s, ns = "0"] = a.created_timestamp.split(".");
  return `${Number(s) - 1}.${ns}`;
}

/** Oldest-first transactions touching the account after `since`, following empty pages' next links. */
async function transactionsSince(accountId: string, since: string): Promise<MirrorTx[]> {
  let next: string | null = `/api/v1/transactions?account.id=${accountId}&timestamp=gt:${since}&order=asc&limit=25`;
  for (let hops = 0; next && hops < 5; hops++) {
    const page: { transactions: MirrorTx[]; links?: { next: string | null } } = await mirror(next);
    if (page.transactions.length > 0) return page.transactions;
    next = page.links?.next ?? null;
  }
  return [];
}

export type WatchResult ={ accounts: number; claimed: { merchant: string; hederaTxId: string; usdcAmount: string }[]; errors: string[] };

const g = globalThis as unknown as { __sangamWatching?: boolean };

export async function watchDeposits(): Promise<WatchResult> {
  const result: WatchResult = { accounts: 0, claimed: [], errors: [] };
  if (g.__sangamWatching) return result; // a tick is still running
  g.__sangamWatching = true;
  try {
    const accounts = listDepositAccounts();
    result.accounts = accounts.length;
    if (accounts.length === 0) return result;
    const cursors = readCursors();
    const token = usdcTokenId();
    const now = Date.now() / 1000;

    for (const { ensName, accountId } of accounts) {
      try {
        // Start at the account's creation: an ascending scan from timestamp 0
        // makes the Mirror Node return empty pages (with a "next" link) for ages.
        const since = cursors[accountId] ?? (await createdAt(accountId));
        const transactions = await transactionsSince(accountId, since);

        for (const tx of transactions) {
          if (now - Number(tx.consensus_timestamp) < NOTICE_GRACE_S) break; // give the x402 notice time; retry next tick
          cursors[accountId] = tx.consensus_timestamp;
          if (tx.result !== "SUCCESS") continue;
          const usdc = (tx.token_transfers ?? []).filter((t) => t.token_id === token);
          const credited = usdc.filter((t) => t.account === accountId && t.amount > 0).reduce((s, t) => s + BigInt(t.amount), 0n);
          if (credited <= 0n) continue;
          const hederaTxId = fromMirrorTxId(tx.transaction_id);
          if (findByTx(hederaTxId)) continue; // already settled from the merchant's notice

          const payer = usdc.find((t) => t.amount < 0)?.account;
          try {
            const settlement = await acceptNotice({
              merchant: ensName,
              hederaTxId,
              payer,
              usdcAmount: credited.toString(),
              // No invoice for a plain transfer: the amount sent is the amount owed.
              quotedInrPaise: usdcAtomicToPaise(credited, await inrPerUsd()),
              source: "transfer",
            });
            result.claimed.push({ merchant: ensName, hederaTxId, usdcAmount: credited.toString() });
            void runPipeline(settlement);
          } catch (err) {
            if (!(err instanceof DuplicateSettlementError)) throw err;
          }
        }
      } catch (err) {
        result.errors.push(`${ensName}: ${(err as Error).message}`);
      }
    }
    writeCursors(cursors);
    return result;
  } finally {
    g.__sangamWatching = false;
  }
}
