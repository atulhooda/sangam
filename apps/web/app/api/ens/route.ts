import { describeMerchant } from "@sangam/ens";
import { merchantEnsName } from "@/lib/server/merchant";

export const dynamic = "force-dynamic";

/** The merchant's ENS identity: records as read from ENS, plus Sangam's ENSv2 registry. */
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name") || merchantEnsName();
  try {
    return Response.json(await describeMerchant(name), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
