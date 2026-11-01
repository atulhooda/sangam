import "server-only";
import { randomUUID } from "node:crypto";
import type { Settlement } from "../types";
import { inrPerUsd, resolveMerchant, usdcAtomicToPaise } from "./money";
import { findByTx, insertSettlement, listSettlements, recentFromPayer, updateSettlement } from "./store";

/*
 * Settlement pipeline, ported from the old apps/settlement-agent, in simulation
 * mode only for now:
 *   - chain verification is skipped (the notice's amount is trusted)
 *   - the 0G decision is the same local rule the old OG_MOCK used
 *   - the UPI payout returns a mock reference (old PSP_MODE=mock)
 *   - no HCS topic is configured, so hcsSequence stays null
 * Real Mirror Node / 0G / RazorpayX / HCS calls get wired back in later.
 */

export const SIM_MODE = { chainVerify: true, og: true, psp: true, ens: true, hcs: true } as const;

/** Pause between steps so the dashboard can show each one. */
const STEP_DELAY_MS = 900;
const pause = () => new Promise((r) => setTimeout(r, STEP_DELAY_MS));

export class DuplicateSettlementError extends Error {}

export type Notice = { merchant: string; hederaTxId: string; payer?: string; usdcAmount: string };

/** Record the notice and return the new row. Call runPipeline(row) afterwards. */
export async function acceptNotice(notice: Notice): Promise<Settlement> {
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
    status: "received",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await insertSettlement(s);
  return s;
}

export async function runPipeline(start: Settlement): Promise<void> {
  try {
    let s = start;
    const merchant = resolveMerchant(s.merchant);
    await pause();

    // 1. Confirm the payment (simulation: trust the notice).
    const fxRate = await inrPerUsd();
    const inrGrossPaise = usdcAtomicToPaise(BigInt(s.usdcAmount), fxRate);
    s = await updateSettlement(s.id, { status: "confirmed", fxRate, inrGrossPaise });
    await pause();

    // 2. Decide (simulation: the old OG_MOCK rule).
    const payerRecent = s.payer ? recentFromPayer(s.payer, 60_000).length : 0;
    const short = inrGrossPaise < merchant.priceInrPaise * 0.95;
    const runaway = payerRecent > 5;
    const decision = short || runaway ? "hold" : "payout";
    const reason = short
      ? "[mock] Received amount is more than 5% below the quote."
      : runaway
        ? "[mock] Payer sent more than 5 payments in the last minute."
        : "[mock] Amount matches the quote and the payer looks normal.";
    const feeBps = 50;
    const payoutPaise = Math.floor(inrGrossPaise * (1 - feeBps / 10_000));
    s = await updateSettlement(s.id, {
      status: "decided",
      decision,
      decisionReason: reason,
      feeBps,
      payoutPaise,
      ogChatId: `mock-${randomUUID()}`,
      ogVerified: null,
    });
    await pause();

    // 3. Pay out over UPI, unless held (simulation: mock reference).
    if (decision === "payout") {
      s = await updateSettlement(s.id, { status: "paid", payoutRef: `mockpout_${randomUUID().slice(0, 12)}`, payoutMode: "mock" });
    } else {
      s = await updateSettlement(s.id, { status: "held" });
    }

    // 4. HCS receipt: no topic configured in simulation, so it stays null.
    await updateSettlement(s.id, { hcsSequence: null });
  } catch (err) {
    await updateSettlement(start.id, { status: "failed", error: (err as Error).message }).catch(() => undefined);
  }
}

export function stats() {
  const all = listSettlements();
  return {
    count: all.length,
    paidCount: all.filter((s) => s.status === "paid").length,
    heldCount: all.filter((s) => s.status === "held").length,
    usdcInAtomic: all.reduce((sum, s) => sum + BigInt(s.usdcAmount), 0n).toString(),
    inrPaidOutPaise: all.filter((s) => s.status === "paid").reduce((sum, s) => sum + (s.payoutPaise ?? 0), 0),
    hcsTopicId: null,
    mode: "simulation" as const,
    mocks: SIM_MODE,
  };
}
