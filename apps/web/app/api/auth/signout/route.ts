import { clearSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearSession();
  return Response.json({ signedOut: true, redirect: "/verify" });
}
