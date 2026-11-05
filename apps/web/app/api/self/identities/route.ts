import { listIdentities } from "@/lib/server/identity";

export const dynamic = "force-dynamic";

/** Verified identities for the desk and the dashboard's merchant badge. */
export async function GET() {
  return Response.json(listIdentities(), { headers: { "cache-control": "no-store" } });
}
