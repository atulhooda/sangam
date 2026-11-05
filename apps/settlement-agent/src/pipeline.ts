import { randomUUID } from "node:crypto";
import { envOr, inrPerUsd, resolveMerchant, usdcAtomicToPaise, type Settlement, type SettlementNotice } from "@sangam/shared";
import { confirmPayment } from "./confirm.ts";
import { decide } from "./decide.ts";
import { payout } from "./payout.ts";
import { writeReceipt } from "./receipt.ts";
import { findByTx, insertSettlement, recentForMerchant, recentFromPayer, updateSettlement } from "./store.ts";

export class DuplicateSettlementError extends Error {}

// Pause between steps so the dashboard can show each one (DEMO_STEP_DELAY_MS).
const stepDelayMs = Number(envOr("DEMO_STEP_DELAY_MS", "0"));
const pause = () => (stepDelayMs > 0 ? new Promise((r) => setTimeout(r, stepDelayMs)) : Promise.resolve());

/** Record the notice and start the pipeline. Returns as soon as the row exists. */
export async function acceptNotice(notice: SettlementNotice): Promise<Settlement> {
  if (findByTx(notice.hederaTxId)) throw new DuplicateSettlementError(`${notice.hederaTxId} already processed`);

  const now = new Date().toISOString();
  const settlement: Settlement = {
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
  await insertSettlement(settlement);

  run(settlement).catch(async (err: Error) => {
    console.error(`[settlement] ${settlement.id} failed: ${err.message}`);
    await updateSettlement(settlement.id, { status: "failed", error: err.message });
  });
  return settlement;
}

async function run(s: Settlement) {
  const merchant = await resolveMerchant(s.merchant);
  await pause();

  // 1. Confirm the payment on-chain.
  const confirmed = await confirmPayment(s.hederaTxId, merchant.hederaPayTo, BigInt(s.usdcAmount));
  const fxRate = await inrPerUsd();
  const inrGrossPaise = usdcAtomicToPaise(confirmed.credited, fxRate);
  const payer = confirmed.payer ?? s.payer;
  s = await updateSettlement(s.id, {
    status: "confirmed",
    usdcAmount: confirmed.credited.toString(),
    payer,
    fxRate,
    inrGrossPaise,
  });
  await pause();

  // 2. Decide with 0G Compute.
  const decision = await decide({
    merchant: s.merchant,
    quotedPaise: merchant.priceInrPaise,
    receivedPaise: inrGrossPaise,
    fxRate,
    payer,
    payerPaymentsLastMinute: payer ? recentFromPayer(payer, 60_000).length : 0,
    merchantRecent: recentForMerchant(s.merchant, 5)
      .filter((r) => r.id !== s.id)
      .map((r) => ({ inrGrossPaise: r.inrGrossPaise, decision: r.decision })),
  });
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
    const result = await payout({ merchant: s.merchant, vpa: merchant.upiHandle, paise: payoutPaise, reference: s.id });
    s = await updateSettlement(s.id, { status: "paid", payoutRef: result.ref, payoutMode: result.mode });
  } else {
    s = await updateSettlement(s.id, { status: "held" });
  }

  // 4. Tamper-evident receipt on HCS.
  const hcsSequence = await writeReceipt({
    id: s.id,
    merchant: s.merchant,
    hederaTxId: s.hederaTxId,
    usdcAmount: s.usdcAmount,
    inrGrossPaise: s.inrGrossPaise,
    payoutPaise: s.payoutPaise,
    decision: s.decision,
    ogChatId: s.ogChatId,
    payoutRef: s.payoutRef,
  });
  await updateSettlement(s.id, { hcsSequence });
}
