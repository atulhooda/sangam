import { listPublicMerchants } from "@/lib/server/identity";

export const dynamic = "force-dynamic";

/**
 * Verified merchants, for the dashboard's badge: ENS name, document type and
 * whether a company certificate is on file. No names, dates of birth,
 * nullifiers or user ids: a person's own profile is GET /api/auth/me.
 */
export async function GET() {
  return Response.json(listPublicMerchants(), { headers: { "cache-control": "no-store" } });
}
