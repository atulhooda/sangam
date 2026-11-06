import { NextResponse, type NextRequest } from "next/server";
import { getVoiceSession } from "@/lib/server/bolo";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/bolo/session/[id] — the panel polls this while/after the call. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/bolo/session/[id]">) {
  const me = await currentUser();
  const { id } = await ctx.params;
  const session = getVoiceSession(id);
  if (!session) return NextResponse.json({ error: "unknown session" }, { status: 404 });
  // Only the session's owner sees its results.
  if (!me || me.identity.label !== session.actor) return NextResponse.json({ error: "not yours" }, { status: 403 });
  return NextResponse.json({
    id: session.id,
    role: session.role,
    status: session.status,
    invoiceId: session.invoiceId,
    payUrl: session.payUrl,
    intent: session.intent,
  });
}
