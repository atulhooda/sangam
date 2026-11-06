import { parentName } from "@sangam/ens";
import { LabelTakenError, findMerchantByLabel } from "@/lib/server/identity";
import { checkDemoLogin, clearFailures, demoLoginsEnabled, ensureDemoMerchant, isLockedOut, noteFailure } from "@/lib/server/demo-logins";
import { burnPasswordCheck, verifyPassword } from "@/lib/server/passwords";
import { createSession, homeFor } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/*
 * Merchant sign-in with shop name + password, for merchants who have proved
 * who they are with Self and set a password. (Self sign-in still works too.)
 * Sangam's demo shops sign in here as well, with the logins in the environment.
 *
 * POST { name, password }   name: "riya-sweets" or "riya-sweets.sangam.eth"
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; password?: unknown };
  const raw = String(body.name ?? "").trim().toLowerCase().slice(0, 120);
  const password = String(body.password ?? "").slice(0, 200);
  if (!raw || !password) return Response.json({ error: "Enter your shop name and password." }, { status: 400 });
  const suffix = `.${parentName()}`;
  const name = raw.endsWith(suffix) ? raw : `${raw}${suffix}`;
  if (isLockedOut(name)) return Response.json({ error: "Too many wrong attempts. Try again in 10 minutes." }, { status: 429 });

  const merchant = findMerchantByLabel(name);
  if (merchant?.password) {
    if (!(await verifyPassword(password, merchant.password))) {
      noteFailure(name);
      return Response.json({ error: "Wrong shop name or password." }, { status: 401 });
    }
    clearFailures(name);
    await createSession(merchant.nullifier, "merchant");
    return Response.json({ ok: true, redirect: homeFor(merchant) });
  }

  // Sangam's demo shops (DEMO_MERCHANT_LOGINS): username or ENS name.
  const demo = demoLoginsEnabled() ? (checkDemoLogin(raw, password) ?? checkDemoLogin(raw.replace(suffix, ""), password)) : null;
  const demoForName = demo && (demo.ensName === name || demo.username === raw) ? demo : null;
  if (!demoForName) {
    if (!merchant) await burnPasswordCheck(password);
    noteFailure(name);
    return Response.json({ error: "Wrong shop name or password." }, { status: 401 });
  }
  clearFailures(name);
  try {
    const identity = await ensureDemoMerchant(demoForName);
    await createSession(identity.nullifier, "merchant");
    return Response.json({ ok: true, redirect: homeFor(identity) });
  } catch (err) {
    if (err instanceof LabelTakenError) return Response.json({ error: `${demoForName.ensName} already belongs to a merchant who signed in with Self.` }, { status: 409 });
    return Response.json({ error: `Could not open the profile: ${(err as Error).message.split("\n")[0]}` }, { status: 502 });
  }
}
