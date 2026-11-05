import { after } from "next/server";
import { handleSellerAction } from "@sangam/ondc";

export const dynamic = "force-dynamic";

/**
 * MOCK ONDC seller app (BPP), standing in for a Retail B2B seller while
 * ONDC's hosted mock and staging are unreachable. It is not part of Sangam:
 * Sangam reaches it only over signed ONDC messages, like any seller app.
 */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const { ack, reply } = await handleSellerAction(action, await req.text(), req.headers.get("authorization"));
  if (reply) after(reply);
  return Response.json(ack, { status: ack.message.ack.status === "ACK" ? 200 : 400 });
}
