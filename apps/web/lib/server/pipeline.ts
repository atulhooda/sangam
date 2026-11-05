import "server-only";
import { randomUUID } from "node:crypto";
import { resolveMerchant } from "@sangam/ens";
import { confirmPayment, writeReceipt } from "@sangam/hedera";
import { decide, mockDecision, ogBalance } from "@sangam/og";
import {
  envOr,
  hasEnv,
  inrPerUsd,
  mocks,
  payout,
  usdcAtomicToPaise,
  type Settlement,
  type SettlementNotice,
  type Stats,
} from "@sangam/shared";
import { findByTx, insertSettlement, listSettlements, recentForMerchant, recentFromPayer, updateSettlement } from "./store";

/*
 * Sangam's settlement pipeline:
 *
 *   1. verify   @sangam/hedera  Mirror Node: did the USDC really land?
 *   2. decide   @sangam/og      0G Compute: pay out or hold, and the fee
 *   3. pay out  @sangam/shared  RazorpayX UPI payout in INR
 *   4. receipt  @sangam/hedera  HCS message: tamper-evident record
 *
 * Each step is real or mocked according to .env (see mocks() in
 * packages/shared/src/config.ts), so services go live one at a time.
 *
 * Simulated payments (the dashboard's simulate button, tx id "sim-…") never
 * touch money or the receipt topic: no chain check, mock payout, no HCS.
 */

export const isSimulatedTx = (tx: string) => tx.startsWith("sim-");

/** Pause between steps so the dashboard can show each one (DEMO_STEP_DELAY_MS). */
const pause = () => {
  const ms = Number(envOr("DEMO_STEP_DELAY_MS", "0"));
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
};

export class DuplicateSettlementError extends Error {}

/** Record the notice and return the new row. Call runPipeline(row) afterwards (in after()). */
export async function acceptNotice(notice: SettlementNotice): Promise<Settlement> {
  if (findByTx(notice.hederaTxId)) throw new DuplicateSettlementError(`${notice.hederaTxId} already processed`);
  const now = new Date().toISOString();
  const s: Settlement = {
    id: randomUUID(),
    merchant: notice.merchant,
    hederaTxId: notice.hederaTxId,
    payer: notice.payer ?? null,
    usdcAmount: notice.usdcAmount,
    fxRate: 0,
    inrGrossPaise: 0,
    feeBps: null,
    payoutPaise: null,
    decision: null,
    decisionReason: null,
    ogChatId: null,
    ogVerified: null,
    payoutRef: null,
    payoutMode: null,
    hcsSequence: null,
    chainVerified: false,
    hcsTopicId: null,
    status: "received",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await insertSettlement(s);
  return s;
}

export async function runPipeline(start: Settlement): Promise<void> {
  const m = mocks();
  const simulated = isSimulatedTx(start.hederaTxId);
  try {
    let s = start;
    const merchant = await resolveMerchant(s.merchant);
    await pause();

    // 1. Verify the payment on-chain.
    const skipChain = simulated || m.chainVerify;
    const confirmed = skipChain
      ? { credited: BigInt(s.usdcAmount), payer: null }
      : await confirmPayment(s.hederaTxId, merchant.hederaPayTo, BigInt(s.usdcAmount));
    const fxRate = await inrPerUsd();
    const inrGrossPaise = usdcAtomicToPaise(confirmed.credited, fxRate);
    const payer = confirmed.payer ?? s.payer;
    s = await updateSettlement(s.id, {
      status: "confirmed",
      usdcAmount: confirmed.credited.toString(),
      payer,
      fxRate,
      inrGrossPaise,
      chainVerified: !skipChain,
    });
    await pause();

    // 2. Decide with 0G Compute (or the local rule when OG_MOCK=true).
    const input = {
      merchant: s.merchant,
      quotedPaise: merchant.priceInrPaise,
      receivedPaise: inrGrossPaise,
      fxRate,
      payer,
      payerPaymentsLastMinute: payer ? recentFromPayer(payer, 60_000).length : 0,
      merchantRecent: recentForMerchant(s.merchant, 6)
        .filter((r) => r.id !== s.id)
        .slice(0, 5)
        .map((r) => ({ inrGrossPaise: r.inrGrossPaise, decision: r.decision })),
    };
    const decision = m.og ? mockDecision(input) : await decide(input);
    const payoutPaise = Math.floor(inrGrossPaise * (1 - decision.feeBps / 10_000));
    s = await updateSettlement(s.id, {
      status: "decided",
      decision: decision.decision,
      decisionReason: decision.reason,
      feeBps: decision.feeBps,
      payoutPaise,
      ogChatId: decision.chatId,
      ogVerified: decision.verified,
    });
    await pause();

    // 3. Pay out over UPI, unless held.
    if (decision.decision === "payout") {
      const result = await payout(
        { merchant: s.merchant, vpa: merchant.upiHandle, paise: payoutPaise, reference: s.id },
        { forceMock: simulated },
      );
      s = await updateSettlement(s.id, { status: "paid", payoutRef: result.ref, payoutMode: result.mode });
    } else {
      s = await updateSettlement(s.id, { status: "held" });
    }

    // 4. Tamper-evident receipt on HCS. A failure here doesn't undo the payout.
    const topicId = process.env.HCS_TOPIC_ID;
    if (!simulated && !m.hcs && topicId) {
      try {
        const hcsSequence = await writeReceipt(topicId, {
          id: s.id,
          merchant: s.merchant,
          hederaTxId: s.hederaTxId,
          usdcAmount: s.usdcAmount,
          fxRate: s.fxRate,
          inrGrossPaise: s.inrGrossPaise,
          feeBps: s.feeBps,
          payoutPaise: s.payoutPaise,
          decision: s.decision,
          ogChatId: s.ogChatId,
          ogVerified: s.ogVerified,
          payoutRef: s.payoutRef,
          payoutMode: s.payoutMode,
        });
        await updateSettlement(s.id, { hcsSequence, hcsTopicId: topicId });
      } catch (err) {
        await updateSettlement(s.id, { error: `HCS receipt failed: ${(err as Error).message}` });
      }
    }
  } catch (err) {
    console.error(`[settlement] ${start.id} failed: ${(err as Error).message}`);
    await updateSettlement(start.id, { status: "failed", error: (err as Error).message }).catch(() => undefined);
  }
}

/* ── stats ── */

const g = globalThis as unknown as { __sangamOgBalance?: { value: string | null; at: number } };

/** 0G ledger balance, cached for 30 s so the dashboard's 1 s poll doesn't hit the chain. */
async function cachedOgBalance(): Promise<string | null> {
  if (mocks().og || !hasEnv("OG_PRIVATE_KEY")) return null;
  const hit = g.__sangamOgBalance;
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  let value: string | null = null;
  try {
    value = await Promise.race([ogBalance(), new Promise<null>((r) => setTimeout(() => r(null), 4_000))]);
  } catch (err) {
    console.warn(`[stats] could not read 0G ledger: ${(err as Error).message}`);
  }
  g.__sangamOgBalance = { value, at: Date.now() };
  return value;
}

export function canSimulate() {
  return process.env.ALLOW_SIMULATE?.trim() !== "false";
}

export function canPayAsAgent() {
  return hasEnv("CUSTOMER_ACCOUNT_ID", "CUSTOMER_PRIVATE_KEY", "SETTLEMENT_SHARED_SECRET");
}

export async function stats(): Promise<Stats> {
  const all = listSettlements();
  const m = mocks();
  const mockedCount = Object.values(m).filter(Boolean).length;
  return {
    count: all.length,
    paidCount: all.filter((s) => s.status === "paid").length,
    heldCount: all.filter((s) => s.status === "held").length,
    usdcInAtomic: all.reduce((sum, s) => sum + BigInt(s.usdcAmount), 0n).toString(),
    inrPaidOutPaise: all.filter((s) => s.status === "paid").reduce((sum, s) => sum + (s.payoutPaise ?? 0), 0),
    hcsTopicId: process.env.HCS_TOPIC_ID || null,
    ogBalance: await cachedOgBalance(),
    mode: mockedCount === Object.keys(m).length ? "simulation" : mockedCount === 0 ? "live" : "mixed",
    mocks: m,
    actions: { simulate: canSimulate(), payAsAgent: canPayAsAgent() },
  };
}
