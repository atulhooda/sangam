import { NextResponse, type NextRequest } from "next/server";
import { negotiate } from "@sangam/og";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * Simulate-only bargaining for the /bargain-preview page: runs the real
 * negotiation engine on a price + margin you pass in, and returns the haggle
 * transcript. No auth, no ENS, no invoice, no payment — nothing is minted or
 * moved, so it's safe to leave in. Defaults to the deterministic engine
 * (useModel=false) so the preview is instant; pass useModel=true to exercise
 * 0G when it's configured.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    product?: string;
    listPaise?: number;
    bargainBps?: number;
    useModel?: boolean;
  };
  const listPaise = Number.isFinite(body.listPaise) && (body.listPaise as number) > 0 ? Math.round(body.listPaise as number) : 50000;
  const bargainBps = Number.isFinite(body.bargainBps) ? Math.max(0, Math.min(5000, Math.round(body.bargainBps as number))) : 500;
  const result = await negotiate({
    product: (body.product ?? "truffle-cake.bakery.sangam.eth").slice(0, 80),
    listPaise,
    bargainBps,
    useModel: body.useModel === true,
  });
  return NextResponse.json(result);
}
