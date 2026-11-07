import OpenAI from "openai";
import { z } from "zod";
import { env, flag } from "@sangam/shared";
import { getBroker } from "./broker.ts";

/*
 * Agent-to-agent haggling, decided with 0G Compute — the same broker/ledger as
 * decide.ts. Each side (buyer / merchant) gets one 0G chat turn at a time and
 * proposes its next offer with a one-line message. OG_MOCK=true (or any 0G
 * error / bad JSON / timeout) falls back to a deterministic concession curve,
 * so a demo always converges. Every turn says which engine produced it (via).
 *
 * The merchant publishes a ± margin on ENS (sangam.bargain): its agent OPENS
 * at list + margin (the ask) and may concede down to list − margin (the
 * floor). Guardrails live in negotiate(), not the model: every offer is
 * clamped into [floorPaise, askPaise] and forced to move toward a deal, and
 * the last round settles. So 0G can reason and banter, but the price can
 * never leave the merchant's published band — which is why the buyer agent's
 * fair-invoice check accepts the deal (see @sangam/ens assertFairInvoice: its
 * ceiling is the ENS price plus this same published margin).
 */

export type BargainSide = "buyer" | "merchant";

export type BargainTurn = {
  by: BargainSide;
  offerPaise: number;
  message: string;
  /** Which engine produced this offer: a verified 0G chat turn, or the local curve. */
  via: "0g" | "local";
};

export type NegotiationInput = {
  /** Product / merchant display name, for the model and the transcript. */
  product: string;
  /** ENS list price in paise — the centre of the band. */
  listPaise: number;
  /** The merchant's published ± margin, in basis points (500 = ±5%). */
  bargainBps: number;
  /** How many buyer↔merchant exchanges (default 3). */
  maxRounds?: number;
  /** Force the 0G model on/off. Default: on unless OG_MOCK is set. */
  useModel?: boolean;
};

export type Negotiation = {
  listPaise: number;
  /** The merchant agent's opening quote: list + margin. */
  askPaise: number;
  /** The lowest the merchant agent may go: list − margin. */
  floorPaise: number;
  agreedPaise: number;
  /** Haggled off the opening ask. */
  savedPaise: number;
  savedBps: number;
  /** Positive when the deal landed below the ENS list price. */
  vsListPaise: number;
  rounds: BargainTurn[];
  /** true when at least one turn came from a verified 0G reply. */
  usedModel: boolean;
  /** How many offers 0G Compute decided (the rest used the local curve). */
  ogTurns: number;
};

const OfferSchema = z.object({
  offerPaise: z.number().int().positive(),
  message: z.string().min(1).max(160),
  accept: z.boolean(),
});
type Offer = z.infer<typeof OfferSchema>;

type TurnCtx = {
  side: BargainSide;
  product: string;
  listPaise: number;
  askPaise: number;
  floorPaise: number;
  round: number;
  maxRounds: number;
  lastOtherOfferPaise: number | null;
  history: BargainTurn[];
};

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

const systemPrompt = (c: TurnCtx) =>
  c.side === "merchant"
    ? `You are the Indian merchant's negotiation agent for "${c.product}". Your list price is ${rupees(c.listPaise)}; you opened high at ${rupees(c.askPaise)} and may discount down to, but NEVER below, ${rupees(c.floorPaise)}. Give a little each round. Reply ONLY JSON {"offerPaise":<int paise>,"message":"<short friendly Hinglish line>","accept":<bool>}. Set accept=true only if the buyer's last offer is at or above a price you're happy with.`
    : `You are the buyer agent haggling for "${c.product}". The seller opened at ${rupees(c.askPaise)}; its published list price is ${rupees(c.listPaise)} and you want the best discount, never offering above ${rupees(c.askPaise)}. Open low and rise a little each round. Reply ONLY JSON {"offerPaise":<int paise>,"message":"<short polite Hinglish line>","accept":<bool>}. Set accept=true only if the merchant's last offer is low enough to be a good deal.`;

async function modelOffer(c: TurnCtx): Promise<{ offer: Offer; verified: boolean } | null> {
  try {
    const broker = await getBroker();
    const provider = env("OG_PROVIDER_ADDRESS");
    const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
    const headers = (await broker.inference.getRequestHeaders(provider)) as unknown as Record<string, string>;
    const openai = new OpenAI({ baseURL: endpoint, apiKey: "", timeout: 20_000 });
    const { data: completion, response } = await openai.chat.completions
      .create(
        {
          model,
          temperature: 0.4,
          messages: [
            { role: "system", content: systemPrompt(c) },
            {
              role: "user",
              content: JSON.stringify({
                round: c.round,
                maxRounds: c.maxRounds,
                lastOtherOfferPaise: c.lastOtherOfferPaise,
                history: c.history,
              }),
            },
          ],
        },
        { headers },
      )
      .withResponse();
    const content = completion.choices[0]?.message.content ?? "";
    const chatId = response.headers.get("ZG-Res-Key") ?? completion.id;
    const verified = await broker.inference.processResponse(provider, chatId, content);
    const match = content.match(/\{[\s\S]*\}/);
    const parsed = match ? OfferSchema.safeParse(JSON.parse(match[0])) : null;
    if (!parsed?.success) return null;
    return { offer: parsed.data, verified: Boolean(verified) };
  } catch {
    return null;
  }
}

/** Deterministic fallback: a concession curve that always converges in the band. */
function mockOffer(c: TurnCtx): Offer {
  const deal = c.floorPaise + Math.round((c.askPaise - c.floorPaise) * 0.35); // buyer-favoured, below list
  const progress = Math.min(1, c.round / c.maxRounds);
  const ease = progress * progress * (3 - 2 * progress); // smoothstep
  if (c.side === "merchant") {
    const offer = Math.round(c.askPaise - (c.askPaise - deal) * ease);
    const accept = c.lastOtherOfferPaise !== null && c.lastOtherOfferPaise >= deal - 1;
    const message = accept
      ? `Theek hai, ${rupees(c.lastOtherOfferPaise!)} mein pakka — deal!`
      : c.round <= 1
        ? `Daam hai ${rupees(c.askPaise)}, par aapke liye ${rupees(offer)} kar deta hoon.`
        : `${rupees(offer)} — isse kam nahi, quality dekhiye.`;
    return { offerPaise: offer, message, accept };
  }
  const low = Math.max(1, c.floorPaise - Math.round((c.askPaise - c.floorPaise) * 0.5));
  const offer = Math.round(low + (deal - low) * ease);
  const accept = c.lastOtherOfferPaise !== null && c.lastOtherOfferPaise <= deal + 1;
  const message = accept
    ? `${rupees(c.lastOtherOfferPaise!)}? Chalega — le liya!`
    : c.round <= 1
      ? `Thoda zyada hai. ${rupees(offer)} mein de dijiye?`
      : `Theek hai, ${rupees(offer)} tak aa sakta hoon.`;
  return { offerPaise: offer, message, accept };
}

export async function negotiate(input: NegotiationInput): Promise<Negotiation> {
  const listPaise = Math.round(input.listPaise);
  const bargainBps = Math.max(0, Math.min(5000, Math.round(input.bargainBps)));
  const askPaise = Math.round(listPaise * (1 + bargainBps / 10_000));
  const floorPaise = Math.max(1, Math.round(listPaise * (1 - bargainBps / 10_000)));
  const maxRounds = Math.max(1, Math.min(5, input.maxRounds ?? 3));
  const live = input.useModel ?? !flag("OG_MOCK");

  const rounds: BargainTurn[] = [
    { by: "merchant", offerPaise: askPaise, message: `Namaste! ${input.product} ka daam ${rupees(askPaise)} hai.`, via: "local" },
  ];
  let usedModel = false;
  let ogTurns = 0;
  let lastMerchant = askPaise;
  let lastBuyer: number | null = null;
  let agreedPaise: number | null = null;

  for (let round = 1; round <= maxRounds; round++) {
    for (const side of ["buyer", "merchant"] as const) {
      const lastOther = side === "buyer" ? lastMerchant : lastBuyer;
      const ctx: TurnCtx = { side, product: input.product, listPaise, askPaise, floorPaise, round, maxRounds, lastOtherOfferPaise: lastOther, history: rounds };
      const res = live ? await modelOffer(ctx) : null;
      if (res) ogTurns++;
      if (res?.verified) usedModel = true;
      const raw = res?.offer ?? mockOffer(ctx);

      // guardrails. The merchant stays in [floor, ask] and never raises its
      // ask. The buyer may lowball below the floor (the merchant just won't
      // accept), but never offers above the ask, and never lowers its own bid.
      let offer = Math.round(raw.offerPaise);
      if (side === "merchant") {
        offer = Math.min(lastMerchant, Math.max(floorPaise, Math.min(askPaise, offer)));
      } else {
        offer = Math.max(1, Math.min(askPaise, offer));
        if (lastBuyer !== null) offer = Math.max(offer, lastBuyer);
      }
      const message = raw.message.slice(0, 160);

      rounds.push({ by: side, offerPaise: offer, message, via: res ? "0g" : "local" });
      if (side === "merchant") lastMerchant = offer;
      else lastBuyer = offer;

      // a deal: either side accepts, or the two offers have crossed/met.
      // Settle at a price inside the band: when the merchant accepts it takes
      // the buyer's offer; otherwise the buyer takes the merchant's ask.
      const crossed = lastBuyer !== null && lastBuyer >= lastMerchant;
      if (raw.accept || crossed) {
        const meet = raw.accept && side === "merchant" ? (lastBuyer ?? lastMerchant) : lastMerchant;
        agreedPaise = Math.max(floorPaise, Math.min(askPaise, meet));
        break;
      }
    }
    if (agreedPaise !== null) break;
  }

  if (agreedPaise === null) {
    // settle at the midpoint of the final offers, inside the band
    const mid = lastBuyer !== null ? Math.round((lastBuyer + lastMerchant) / 2) : lastMerchant;
    agreedPaise = Math.max(floorPaise, Math.min(askPaise, mid));
    rounds.push({ by: "merchant", offerPaise: agreedPaise, message: `Chaliye, beech mein ${rupees(agreedPaise)} — deal pakki!`, via: "local" });
  }

  const savedPaise = askPaise - agreedPaise;
  return {
    listPaise,
    askPaise,
    floorPaise,
    agreedPaise,
    savedPaise,
    savedBps: askPaise > 0 ? Math.round((savedPaise / askPaise) * 10_000) : 0,
    vsListPaise: listPaise - agreedPaise,
    rounds,
    usedModel,
    ogTurns,
  };
}
