import { cookies } from "next/headers";
import { parentName, validLabel } from "@sangam/ens";
import { LOGIN_COOKIE, LOGIN_TTL_S, startLogin } from "@/lib/server/logins";
import { cookieOptions } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Labels Sangam issues to itself (the ONDC gateway, ONDC sellers). */
const RESERVED = (label: string) => label === "ondc" || label.startsWith("ondc-") || label === "www" || label === "admin";

/**
 * Begin a Self sign-in: returns the userId to put in the QR, and ties the
 * attempt to this browser with an httpOnly cookie. The role is fixed here,
 * server-side, so the proof can't be replayed into a different role.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { role?: string; label?: string };
  const role = body.role === "merchant" ? "merchant" : body.role === "user" ? "user" : null;
  if (!role) return Response.json({ error: "role must be merchant or user" }, { status: 400 });

  // Merchants pick a label; Sangam issues <label>.sangam.eth at onboarding.
  let label = "";
  if (role === "merchant") {
    const suffix = `.${parentName()}`;
    const raw = (body.label ?? "").trim().toLowerCase();
    const short = raw.endsWith(suffix) ? raw.slice(0, -suffix.length) : raw;
    // New merchants claim a name after the proof (onboarding); an empty one is fine here.
    if (short && !validLabel(short)) {
      return Response.json({ error: "Pick a shop name: 3–63 lowercase letters, digits or hyphens, e.g. riya-sweets" }, { status: 400 });
    }
    if (short && RESERVED(short)) return Response.json({ error: `${short}${suffix} is reserved for Sangam.` }, { status: 400 });
    label = short ? `${short}${suffix}` : "";
  }

  const { userId, secret } = startLogin(role, label);
  (await cookies()).set(LOGIN_COOKIE, secret, cookieOptions(LOGIN_TTL_S));
  return Response.json({ userId, role, label });
}
