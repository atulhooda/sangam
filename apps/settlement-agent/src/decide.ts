import { randomUUID } from "node:crypto";
import { createZGComputeNetworkBroker, type ZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { ethers } from "ethers";
import OpenAI from "openai";
import { z } from "zod";
import { env, envOr, flag } from "@sangam/shared";

export type DecisionInput = {
  merchant: string;
  quotedPaise: number;
  receivedPaise: number;
  fxRate: number;
  payer: string | null;
  payerPaymentsLastMinute: number;
  merchantRecent: { inrGrossPaise: number; decision: string | null }[];
};

export type Decision = {
  decision: "payout" | "hold";
  reason: string;
  feeBps: number;
  chatId: string;
  verified: boolean | null;
};

const DecisionSchema = z.object({
  decision: z.enum(["payout", "hold"]),
  reason: z.string().min(1).max(280),
  feeBps: z.number().int().min(0).max(500),
});

const SYSTEM_PROMPT = `You are the settlement risk officer for Sangam, a rail that turns USDC payments from AI agents into UPI rupee payouts for Indian merchants.
For each payment, decide whether to pay the merchant out now or hold it for review, and set the fee.

Rules:
- hold if receivedPaise is more than 5% below quotedPaise.
- hold if payerPaymentsLastMinute is above 5 (possible runaway agent).
- otherwise payout.
- feeBps between 50 and 200. Use 50 for small, routine payments; go higher for unusual size versus merchantRecent.

Reply with ONLY a JSON object: {"decision":"payout"|"hold","reason":"<one sentence>","feeBps":<integer>}`;

/** Decide on one settlement with 0G Compute. OG_MOCK=true uses a local rule instead (dev only). */
export async function decide(input: DecisionInput): Promise<Decision> {
  if (flag("OG_MOCK")) return mockDecision(input);

  const broker = await getBroker();
  const provider = env("OG_PROVIDER_ADDRESS");
  const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
  // Headers are single-use, so fetch new ones for every request.
  const headers = (await broker.inference.getRequestHeaders(provider)) as unknown as Record<string, string>;

  const openai = new OpenAI({ baseURL: endpoint, apiKey: "" });
  const { data: completion, response } = await openai.chat.completions
    .create(
      {
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(input) },
        ],
      },
      { headers },
    )
    .withResponse();

  const content = completion.choices[0]?.message.content ?? "";
  const chatId = response.headers.get("ZG-Res-Key") ?? completion.id;
  const verified = await broker.inference.processResponse(provider, chatId, content);

  const parsed = DecisionSchema.safeParse(extractJson(content));
  if (!parsed.success) {
    return { decision: "hold", reason: "Model reply was not valid decision JSON; held for review.", feeBps: 0, chatId, verified };
  }
  return { ...parsed.data, chatId, verified };
}

/** 0G ledger balance in OG, or null in mock mode. */
export async function ogBalance(): Promise<string | null> {
  if (flag("OG_MOCK")) return null;
  const ledger = await (await getBroker()).ledger.getLedger();
  return ethers.formatEther(ledger.availableBalance);
}

let brokerPromise: Promise<ZGComputeNetworkBroker> | null = null;

function getBroker(): Promise<ZGComputeNetworkBroker> {
  brokerPromise ??= (async () => {
    const provider = new ethers.JsonRpcProvider(envOr("OG_RPC_URL", "https://evmrpc-testnet.0g.ai"));
    const wallet = new ethers.Wallet(env("OG_PRIVATE_KEY"), provider);
    return createZGComputeNetworkBroker(wallet);
  })();
  return brokerPromise;
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function mockDecision(input: DecisionInput): Decision {
  const short = input.receivedPaise < input.quotedPaise * 0.95;
  const runaway = input.payerPaymentsLastMinute > 5;
  const decision = short || runaway ? "hold" : "payout";
  const reason = short
    ? "[mock] Received amount is more than 5% below the quote."
    : runaway
      ? "[mock] Payer sent more than 5 payments in the last minute."
      : "[mock] Amount matches the quote and the payer looks normal.";
  return { decision, reason, feeBps: 50, chatId: `mock-${randomUUID()}`, verified: null };
}
