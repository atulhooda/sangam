import { checkName } from "@/lib/server/names";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/merchant/name?label=riya-sweets → is riya-sweets.sangam.eth free? (with alternatives if not) */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("label") ?? "";
  if (!raw.trim()) return Response.json({ error: "label is required" }, { status: 400 });
  const me = await currentUser();
  const claimant = me?.session.role === "merchant" ? me.identity.nullifier : undefined;
  try {
    return Response.json(await checkName(raw, claimant), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `Could not check ENS right now: ${(err as Error).message.split("\n")[0]}` }, { status: 502 });
  }
}
