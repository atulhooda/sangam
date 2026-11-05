import { stats } from "@/lib/server/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await stats(), { headers: { "cache-control": "no-store" } });
}
