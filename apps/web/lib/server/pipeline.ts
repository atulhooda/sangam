import "server-only";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { issueSubname, resolveMerchant } from "@sangam/ens";
import { confirmPayment, createScheduledRefund, writeReceipt } from "@sangam/hedera";
import { decide, mockDecision, ogBalance } from "@sangam/og";
import * as whitechain from "@sangam/whitechain";
import {
  envOr,
  hasEnv,
  inrPerUsd,
  mocks,
  payout,
  type Rail,
  usdcAtomicToPaise,
  type Settlement,
  type SettlementNotice,
  type Stats,
} from "@sangam/shared";
import { budgetSnapshot } from "./budget";
import { findByTx, insertSettlement, listSettlements, recentForMerchant, recentFromPayer, updateSettlement } from "./store";

/*
 * Sangam's settlement pipeline:
 *
 *   0. identify @sangam/ens     resolve the merchant; ONDC sellers get their
 *                               ondc-<seller>.sangam.eth subname on first order
 *   1. verify   @sangam/hedera  Mirror Node: did the USDC really land?
 *               @sangam/whitechain  or, for USDT on Whitechain, the tx receipt's Transfer logs
 *   2. decide   @sangam/og      0G Compute: pay out or hold, and the fee
 *   3. pay out  @sangam/shared  RazorpayX UPI payout in INR
 *   4. receipt  @sangam/hedera  HCS message: tamper-evident record
 *               @sangam/whitechain  or the SangamReceipts contract (hash-chained, one per payment)
 *
 * Each step is real or mocked according to .env (see mocks() in
 * packages/shared/src/config.ts), so services go live one at a time.
 *
 * Simulated payments (the dashboard's simulate button, tx id "sim-…") never
 * touch money or the receipt topic: no chain check, mock payout, no HCS.
 */

export const isSimulatedTx = (tx: string) => tx.startsWith("sim-");

/** The rail a notice is on: as stated, else from the transaction id's format (0x… hash = Whitechain). */
const railOf = (n: { rail?: Rail; hederaTxId: string }): Rail => n.rail ?? (whitechain.isWhitechainTx(n.hederaTxId) ? "whitechain" : "hedera");

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
    quotedInrPaise: notice.quotedInrPaise ?? null,
    ondc: notice.ondc ?? null,
    product: notice.product ?? null,
    source: notice.source ?? "x402",
    rail: railOf(notice),
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
    const merchant = await identifyMerchant(s);
    await pause();

    // 1. Verify the payment on-chain, on whichever rail it came in on.
    const rail = railOf(s);
    // On Whitechain, USDT lands in the merchant's deposit address: the one in ENS, else the derived one.
    const payTo = rail === "whitechain" ? (merchant.whitechainPayTo ?? whitechain.depositAddress(s.merchant)) : merchant.hederaPayTo;
    const skipChain = simulated || m.chainVerify;
    const confirmed = skipChain
      ? { credited: BigInt(s.usdcAmount), payer: null }
      : rail === "whitechain"
        ? await whitechain.confirmPayment(s.hederaTxId, payTo, BigInt(s.usdcAmount))
        : await confirmPayment(s.hederaTxId, payTo, BigInt(s.usdcAmount));
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
      quotedPaise: s.quotedInrPaise ?? merchant.priceInrPaise,
      receivedPaise: inrGrossPaise,
      fxRate,
      payer,
      payerPaymentsLastMinute: payer ? recentFromPayer(payer, 60_000).length : 0,
      merchantRecent: recentForMerchant(s.merchant, 6)
        .filter((r) => r.id !== s.id)
        .slice(0, 5)
        .map((r) => ({ inrGrossPaise: r.inrGrossPaise, decision: r.decision })),
    };
    let decision = m.og ? mockDecision(input) : await decide(input);
    // Never pay a seller who didn't accept the ONDC order.
    if (s.ondc && s.ondc.state !== "Accepted") {
      decision = { ...decision, decision: "hold", reason: `ONDC order not accepted (${s.ondc.state}); held for review.` };
    }
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

    // 3. Pay out over UPI, unless held. A held payment gets a scheduled USDC
    // refund back to the payer: the schedule executes on Hedera once the
    // treasury's signature is on it, and nobody can alter it afterwards.
    if (decision.decision === "payout") {
      const result = await payout(
        { merchant: s.merchant, vpa: merchant.upiHandle, paise: payoutPaise, reference: s.id },
        { forceMock: simulated },
      );
      s = await updateSettlement(s.id, { status: "paid", payoutRef: result.ref, payoutMode: result.mode });
    } else {
      s = await updateSettlement(s.id, { status: "held" });
      if (!simulated && rail === "whitechain" && payer && whitechain.whitechainEnabled()) {
        // The deposit address is Sangam-derived, so Sangam signs a gasless USDT
        // transfer back to the payer and the relayer submits it.
        if (payTo.toLowerCase() === whitechain.depositAddress(s.merchant).toLowerCase()) {
          try {
            const tx = await whitechain.gaslessTransfer(whitechain.depositKey(s.merchant), payer as `0x${string}`, BigInt(s.usdcAmount));
            s = await updateSettlement(s.id, {
              refund: { rail: "whitechain", scheduleId: "", transactionId: tx, amountAtomic: s.usdcAmount, payer, createdAt: new Date().toISOString() },
            });
          } catch (err) {
            await updateSettlement(s.id, { error: `refund failed: ${(err as Error).message.split("\n")[0]}` });
          }
        }
      } else if (!simulated && rail === "hedera" && !m.hcs && payer && hasEnv("OPERATOR_ACCOUNT_ID", "OPERATOR_PRIVATE_KEY", "TREASURY_ACCOUNT_ID")) {
        try {
          // From the account that received it: the merchant's deposit account, or the shared treasury.
          const refund = await createScheduledRefund(payer, s.usdcAmount, `Sangam refund ${s.id}`, merchant.hederaPayTo);
          s = await updateSettlement(s.id, { refund: { ...refund, createdAt: new Date().toISOString() } });
        } catch (err) {
          await updateSettlement(s.id, { error: `scheduled refund failed: ${(err as Error).message}` });
        }
      }
    }

    // 4. Tamper-evident receipt, hash-chained to the one before it: on HCS for
    // Hedera payments, in the SangamReceipts contract for Whitechain ones. A
    // failure here doesn't undo the payout.
    if (!simulated && rail === "whitechain" && whitechain.whitechainEnabled() && whitechain.receiptsAddress()) {
      try {
        const written = await whitechain.writeReceipt(s.hederaTxId as `0x${string}`, {
          id: s.id,
          merchant: s.merchant,
          usdtAmount: s.usdcAmount,
          fxRate: s.fxRate,
          inrGrossPaise: s.inrGrossPaise,
          feeBps: s.feeBps,
          payoutPaise: s.payoutPaise,
          decision: s.decision,
          ogChatId: s.ogChatId,
          ogVerified: s.ogVerified,
          payoutRef: s.payoutRef,
          payoutMode: s.payoutMode,
          ...(s.refund ? { refundTx: s.refund.transactionId } : {}),
        });
        await updateSettlement(s.id, { hcsSequence: written.seq, receiptTx: written.tx });
      } catch (err) {
        await updateSettlement(s.id, { error: `receipt failed: ${(err as Error).message.split("\n")[0]}` });
      }
    }
    const topicId = process.env.HCS_TOPIC_ID;
    if (!simulated && rail === "hedera" && !m.hcs && topicId) {
      try {
        const { seq: hcsSequence } = await writeReceipt(topicId, {
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
          ...(s.refund ? { refundScheduleId: s.refund.scheduleId } : {}),
          ...(s.ondc ? { ondcOrderId: s.ondc.orderId, ondcTransactionId: s.ondc.transactionId, ondcSeller: s.ondc.bppId } : {}),
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

/**
 * Resolve the merchant by ENS name. An ONDC seller Sangam hasn't settled for
 * before has no name yet, so Sangam issues ondc-<seller>.sangam.eth first,
 * with the seller's UPI handle from ONDC's on_init settlement details. Every
 * later step reads the merchant from ENS, like any other merchant.
 */
async function identifyMerchant(s: Settlement) {
  try {
    return await resolveMerchant(s.merchant);
  } catch (err) {
    if (!s.ondc) throw err;
    const label = s.merchant.split(".")[0]!;
    console.log(`[settlement] issuing ${s.merchant} for ONDC seller ${s.ondc.providerName}`);
    await issueSubname(label, {
      endpoint: s.ondc.bppUri,
      hederaPayTo: process.env.TREASURY_ACCOUNT_ID ?? "",
      network: "hedera:testnet",
      priceInrPaise: s.ondc.quoteInrPaise,
      upiHandle: s.ondc.sellerUpi,
    });
    return resolveMerchant(s.merchant);
  }
}

/* ── stats ── */

const g = globalThis as unknown as {
  __sangamOgBalance?: { value: string | null; at: number };
  __sangamWcHead?: { value: Awaited<ReturnType<typeof whitechain.readReceiptsHead>>; at: number };
};

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
    budget: await budgetSnapshot(),
    /** The buyer agent's Hedera account, so the buyer desk can show its purchases. */
    customerAccountId: hasEnv("CUSTOMER_ACCOUNT_ID") ? process.env.CUSTOMER_ACCOUNT_ID! : null,
    rails: whitechain.whitechainEnabled() ? ["hedera", "whitechain"] : ["hedera"],
    whitechain: await whitechainStats(),
  };
}

/** The Whitechain rail for the dashboard, with the receipts chain tip cached 15 s. */
async function whitechainStats(): Promise<Stats["whitechain"]> {
  if (!whitechain.whitechainEnabled()) return null;
  const hit = g.__sangamWcHead;
  let head = hit && Date.now() - hit.at < 15_000 ? hit.value : undefined;
  if (head === undefined) {
    head = await Promise.race([whitechain.readReceiptsHead(), new Promise<null>((r) => setTimeout(() => r(null), 4_000))]).catch(() => null);
    g.__sangamWcHead = { value: head, at: Date.now() };
  }
  return {
    receiptsContract: whitechain.receiptsAddress(),
    receiptsCount: head?.count ?? null,
    receiptsHead: head?.head ?? null,
    relayer: whitechain.relayerAccount().address,
    customerAddress: customerWhitechainAddress(),
  };
}

/** The dashboard agent's Whitechain address: CUSTOMER_PRIVATE_KEY is secp256k1, so it signs on both chains. */
export function customerWhitechainAddress(): string | null {
  const key = process.env.CUSTOMER_PRIVATE_KEY?.trim();
  if (!key) return null;
  try {
    return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`).address;
  } catch {
    return null;
  }
}
