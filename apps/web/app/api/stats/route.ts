import { stats } from "@/lib/server/pipeline";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(stats(), { headers: { "cache-control": "no-store" } });
}
