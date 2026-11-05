import { receiveCallback } from "@sangam/ondc";

export const dynamic = "force-dynamic";

/**
 * Sangam's ONDC buyer-app callbacks (bap_uri): on_search, on_select,
 * on_init, on_confirm, on_status. Each is signature-checked against the
 * registry before it's accepted.
 */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!action.startsWith("on_")) return Response.json({ message: { ack: { status: "NACK" } } }, { status: 404 });
  const ack = await receiveCallback(action, await req.text(), req.headers.get("authorization"));
  return Response.json(ack, { status: ack.message.ack.status === "ACK" ? 200 : 401 });
}
