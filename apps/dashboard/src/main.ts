/// <reference types="vite/client" />
import type { Settlement } from "../../../packages/shared/src/types.ts";

// Blank means the Vite dev proxy (see vite.config.ts).
const API = import.meta.env.VITE_SETTLEMENT_URL || "/api";
const MERCHANT = import.meta.env.VITE_MERCHANT_URL || "/merchant";

type Stats = {
  count: number;
  usdcInAtomic: string;
  inrPaidOutPaise: number;
  ogBalance: string | null;
  hcsTopicId: string | null;
  mocks: { og: boolean; psp: boolean; chainVerify: boolean; ens: boolean };
};

type Quote = {
  merchant: string;
  priceInr: number;
  priceUsdc: string;
  network: string;
  payTo: string;
  upiHandle: string;
};

type Invoice = {
  x402Version: number;
  accepts: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: { feePayer?: string } }[];
};

type StepState = "done" | "active" | "warn" | "fail" | "todo";

const STEPS = [
  { who: "Agent", title: "Finds the merchant", detail: "Looks up the ENS name to get the shop's URL and price" },
  { who: "Merchant", title: "Sends an invoice", detail: "Replies 402 Payment Required: amount, token, account to pay" },
  { who: "Agent", title: "Pays in USDC", detail: "Signs a USDC transfer on Hedera; the facilitator submits it" },
  { who: "Sangam", title: "Checks and decides", detail: "Confirms the payment on-chain, then 0G decides: pay out or hold" },
  { who: "Merchant", title: "Gets rupees", detail: "Paid in INR to their UPI ID, receipt written to Hedera HCS" },
];

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const usdc = (atomic: string, dp = 4) => (Number(atomic) / 1e6).toFixed(dp);
const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (s: string, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);

/** Where a settlement is in the five steps. Steps 1–3 happen before Sangam hears about it. */
function stepStates(s: Settlement | undefined): StepState[] {
  if (!s) return ["todo", "todo", "todo", "todo", "todo"];
  switch (s.status) {
    case "received":
    case "confirmed":
      return ["done", "done", "done", "active", "todo"];
    case "decided":
      return ["done", "done", "done", "done", "active"];
    case "paid":
      return ["done", "done", "done", "done", "done"];
    case "held":
      return ["done", "done", "done", "warn", "todo"];
    case "failed":
      return ["done", "done", "done", "fail", "todo"];
  }
}

function renderFlow(latest: Settlement | undefined) {
  const states = stepStates(latest);
  $("flow").innerHTML = STEPS.map(
    (step, i) => `<li class="step ${states[i]}">
      <span class="num">${i + 1}</span>
      <span class="who">${step.who}</span>
      <span class="title">${step.title}</span>
      <span class="detail">${step.detail}</span>
    </li>`,
  ).join("");

  if (!latest) return;
  const outcome =
    latest.status === "paid"
      ? `merchant received ${rupees(latest.payoutPaise ?? 0)}`
      : latest.status === "held"
        ? "held for review"
        : latest.status === "failed"
          ? `failed: ${latest.error ?? "unknown error"}`
          : "in progress…";
  $("flow-caption").textContent = `Latest payment: ${usdc(latest.usdcAmount)} USDC from ${latest.payer ?? "agent"}, ${outcome}`;
}

function renderStats(s: Stats) {
  $("count").textContent = String(s.count);
  $("usdc").textContent = usdc(s.usdcInAtomic);
  $("inr").textContent = rupees(s.inrPaidOutPaise);
  $("og").textContent = s.ogBalance === null ? "mock" : `${Number(s.ogBalance).toFixed(4)} OG`;

  const labels = [
    s.mocks.og && "0G mocked",
    s.mocks.psp && "UPI payout mocked",
    s.mocks.chainVerify && "chain check skipped",
    s.mocks.ens && "ENS offline",
  ].filter(Boolean) as string[];
  $("mocks").innerHTML = labels.map((l) => `<span>${l}</span>`).join("");
}

function renderTry(s: Stats) {
  if (s.mocks.chainVerify) {
    $("try-note").textContent =
      "Simulation mode: send a payment as if an agent had just paid, then watch the steps above.";
    if (!document.getElementById("sim-ok")) {
      $("try-actions").innerHTML = `
        <button id="sim-ok">Send a payment</button>
        <button id="sim-short" class="secondary">Send an underpayment</button>`;
      $("sim-ok").addEventListener("click", () => simulate(false));
      $("sim-short").addEventListener("click", () => simulate(true));
    }
  } else {
    $("try-note").textContent = "Real mode: payments come from the buyer agent. Run this in a terminal:";
    $("try-actions").innerHTML = `<code>npm run buy -- --merchant ${esc(currentMerchant ?? "tickets.sangam.eth")} --count 3</code>`;
  }
}

async function simulate(underpay: boolean) {
  const buttons = document.querySelectorAll<HTMLButtonElement>("#try-actions button");
  buttons.forEach((b) => (b.disabled = true));
  try {
    await fetch(`${API}/dev/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ short: underpay }),
    });
    await tick();
  } finally {
    setTimeout(() => buttons.forEach((b) => (b.disabled = false)), 600);
  }
}

function renderRows(items: Settlement[], topicId: string | null) {
  if (items.length === 0) return;
  $("rows").innerHTML = items
    .map((s) => {
      const time = new Date(s.createdAt).toLocaleTimeString("en-IN");
      const out = s.payoutPaise !== null && s.status === "paid" ? rupees(s.payoutPaise) : "—";
      const dots = stepStates(s).map((st) => `<i class="${st}"></i>`).join("");
      const reason = s.error
        ? `<span class="reason">${esc(s.error)}</span>`
        : s.decisionReason
          ? `<span class="reason">${esc(s.decisionReason)}<small>fee ${s.feeBps} bps · chat ${esc(short(s.ogChatId ?? "", 6))}</small></span>`
          : "—";
      const proof = [
        s.hederaTxId.startsWith("sim-")
          ? `<code>simulated tx</code>`
          : `<a href="https://hashscan.io/testnet/transaction/${encodeURIComponent(s.hederaTxId)}" target="_blank" rel="noopener">USDC tx ↗</a>`,
        s.payoutRef && `<code>UPI ${esc(short(s.payoutRef, 8))}</code>`,
        s.hcsSequence !== null && topicId
          ? `<a href="https://hashscan.io/testnet/topic/${esc(topicId)}" target="_blank" rel="noopener">HCS #${s.hcsSequence} ↗</a>`
          : null,
      ]
        .filter(Boolean)
        .join("");
      return `<tr>
        <td class="time">${time}</td>
        <td><div class="dots" title="${esc(s.status)}">${dots}</div></td>
        <td class="num">${usdc(s.usdcAmount)}</td>
        <td class="num">${out}</td>
        <td><span class="pill ${esc(s.status)}">${esc(s.status)}</span></td>
        <td>${reason}</td>
        <td><div class="proof">${proof}</div></td>
      </tr>`;
    })
    .join("");
}

let currentMerchant: string | null = null;

async function loadMerchant() {
  try {
    const q = (await fetch(`${MERCHANT}/quote`).then((r) => r.json())) as Quote;
    currentMerchant = q.merchant;
    $("merchant").innerHTML = `
      <dt>ENS name</dt><dd><strong>${esc(q.merchant)}</strong></dd>
      <dt>Sells</dt><dd>Rail tickets</dd>
      <dt>Price</dt><dd><span class="big">₹${esc(q.priceInr)}</span> <small>≈ ${esc(q.priceUsdc)} USDC at today's rate</small></dd>
      <dt>USDC goes to</dt><dd><code>${esc(q.payTo)}</code> <small>Sangam treasury on ${esc(q.network)}</small></dd>
      <dt>Rupees go to</dt><dd><code>${esc(q.upiHandle)}</code> <small>the UPI ID from the merchant's shop QR</small></dd>`;
  } catch {
    $("merchant").innerHTML = `<dt>Unreachable</dt><dd>merchant-api isn't running on :3000</dd>`;
  }
}

async function loadInvoice() {
  try {
    const res = await fetch(`${MERCHANT}/book?from=CSMT&to=PUNE`, { headers: { accept: "application/json" } });
    const header = res.headers.get("PAYMENT-REQUIRED");
    if (res.status !== 402 || !header) throw new Error(`expected 402, got ${res.status}`);
    const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));
    const invoice = JSON.parse(new TextDecoder().decode(bytes)) as Invoice;
    const a = invoice.accepts[0]!;
    $("invoice").innerHTML = `
      <dt>Status</dt><dd><strong>402 Payment Required</strong></dd>
      <dt>Amount</dt><dd><span class="big">${usdc(a.amount, 6)} USDC</span></dd>
      <dt>Token</dt><dd><code>${esc(a.asset)}</code> <small>USDC on Hedera testnet</small></dd>
      <dt>Pay to</dt><dd><code>${esc(a.payTo)}</code></dd>
      <dt>Network fee paid by</dt><dd><code>${esc(a.extra?.feePayer ?? "—")}</code> <small>the x402 facilitator, so the agent needs no HBAR</small></dd>
      <dt>Valid for</dt><dd>${a.maxTimeoutSeconds}s</dd>`;
    $("invoice-raw").textContent = JSON.stringify(invoice, null, 2);
  } catch (err) {
    $("invoice").innerHTML = `<dt>Unavailable</dt><dd>${esc((err as Error).message)}</dd>`;
  }
}

async function tick() {
  try {
    const [stats, items] = await Promise.all([
      fetch(`${API}/stats`).then((r) => r.json() as Promise<Stats>),
      fetch(`${API}/settlements`).then((r) => r.json() as Promise<Settlement[]>),
    ]);
    renderStats(stats);
    renderTry(stats);
    renderFlow(items[0]);
    renderRows(items, stats.hcsTopicId);
  } catch {
    $("mocks").innerHTML = `<span>settlement agent unreachable</span>`;
  }
}

renderFlow(undefined);
loadMerchant();
loadInvoice();
tick();
setInterval(tick, 1_000);
setInterval(loadInvoice, 30_000);
