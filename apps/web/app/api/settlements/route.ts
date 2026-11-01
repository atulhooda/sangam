import { listSettlements } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listSettlements(), { headers: { "cache-control": "no-store" } });
}
