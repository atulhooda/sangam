import { timingSafeEqual } from "node:crypto";
import { envOr } from "@sangam/shared";
import { watchDeposits } from "@/lib/server/watcher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One pass of the deposit-account watcher. Called every 20 s by
 * instrumentation.ts on this server; also callable by hand with the
 * settlement secret.
 */
export async function POST(req: Request) {
  const expected = Buffer.from(envOr("SETTLEMENT_SHARED_SECRET", ""));
  const got = Buffer.from(req.headers.get("x-sangam-key") ?? "");
  if (expected.length === 0 || got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return Response.json({ error: "bad x-sangam-key" }, { status: 401 });
  }
  return Response.json(await watchDeposits());
}
