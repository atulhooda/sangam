import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { envOr } from "@sangam/shared";
import { DuplicateSettlementError, acceptNotice, isSimulatedTx, runPipeline } from "@/lib/server/pipeline";
import { listSettlements } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  // Optional filters so the merchant and buyer desks read only their own rows:
  //   /api/settlements?merchant=tickets.sangam.eth
  //   /api/settlements?payer=0.0.xxxxx
  let rows = listSettlements();
  const url = new URL(req.url);
  const merchant = url.searchParams.get("merchant");
  const payer = url.searchParams.get("payer");
  if (merchant) rows = rows.filter((s) => s.merchant.toLowerCase() === merchant.toLowerCase());
  if (payer) rows = rows.filter((s) => s.payer === payer);
  return Response.json(rows, { headers: { "cache-control": "no-store" } });
}

const NoticeSchema = z.object({
  merchant: z.string().min(1),
  hederaTxId: z.string().min(1).refine((tx) => !isSimulatedTx(tx), "sim- transaction ids are reserved for /api/simulate"),
  payer: z.string().optional(),
  usdcAmount: z.string().regex(/^\d+$/),
  quotedInrPaise: z.number().int().positive().optional(),
  ondc: z
    .object({
      transactionId: z.string(),
      orderId: z.string(),
      state: z.string(),
      bppId: z.string(),
      bppUri: z.string().url(),
      providerId: z.string(),
      providerName: z.string(),
      items: z.array(z.object({ id: z.string(), name: z.string(), count: z.number().int().positive() })),
      quoteInrPaise: z.number().int().positive(),
      sellerUpi: z.string().min(3),
    })
    .optional(),
});

function authorised(req: Request): boolean {
  const expected = Buffer.from(envOr("SETTLEMENT_SHARED_SECRET", ""));
  const got = Buffer.from(req.headers.get("x-sangam-key") ?? "");
  return expected.length > 0 && got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * Settlement notice: a merchant tells Sangam it was paid over x402. Sangam
 * doesn't take its word for it; the pipeline checks the chain before paying out.
 * Answers 202 straight away and settles in the background.
 */
export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: "bad x-sangam-key" }, { status: 401 });
  const notice = NoticeSchema.safeParse(await req.json().catch(() => null));
  if (!notice.success) return Response.json({ error: notice.error.message }, { status: 400 });
  try {
    const settlement = await acceptNotice(notice.data);
    after(() => runPipeline(settlement));
    return Response.json(settlement, { status: 202 });
  } catch (err) {
    if (err instanceof DuplicateSettlementError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
