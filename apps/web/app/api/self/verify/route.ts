import { AllIds, DefaultConfigStore, SelfBackendVerifier } from "@selfxyz/core";
import { LabelTakenError, upsertIdentity } from "@/lib/server/identity";
import { findLoginByUserId } from "@/lib/server/logins";
import { SELF_SCOPE, selfEndpoint, selfMock } from "@/lib/self-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * The Self offchain SDK's backend half. The Self phone app scans the sign-in
 * QR, generates a zero-knowledge proof from the person's Aadhaar QR (or
 * passport) and its relayer POSTs it here. We verify the proof, store only
 * what it chose to disclose, and mark the matching sign-in (by the QR's
 * userId) as verified, so the browser that started it can collect a session.
 *
 * Role and merchant name come from that server-side sign-in, not from the
 * proof's userDefinedData: the browser can't change its role after the QR is
 * issued. Scope, endpoint and mock flag come from lib/self-config.ts, the
 * same values the QR was built with.
 */

function makeVerifier(endpoint: string) {
  return new SelfBackendVerifier(
    SELF_SCOPE,
    endpoint,
    selfMock(),
    AllIds, // passport, EU ID card, Aadhaar, KYC
    new DefaultConfigStore({ minimumAge: 18, ofac: false }),
    "uuid",
  );
}

type SelfProofBody = {
  attestationId?: number;
  proof?: { a?: unknown; b?: unknown; c?: unknown };
  publicSignals?: unknown;
  userContextData?: string;
};

const fail = (reason: string, error_code: string, status = 200) =>
  Response.json({ status: "error", result: false, reason, error_code }, { status });

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SelfProofBody;
  const { attestationId, proof, publicSignals, userContextData } = body;
  if (!proof || !publicSignals || !attestationId || !userContextData) {
    return fail("proof, publicSignals, attestationId and userContextData are required", "BAD_REQUEST", 400);
  }
  // Mock mode accepts Self's fake test documents. A production server only
  // does that when someone opts in on purpose.
  if (process.env.NODE_ENV === "production" && selfMock() && process.env.ALLOW_SELF_MOCK?.trim() !== "true") {
    return fail("Self is in mock mode on a production server. Set NEXT_PUBLIC_SELF_MOCK=false (or ALLOW_SELF_MOCK=true for a test deploy).", "MOCK_IN_PRODUCTION");
  }

  let login: ReturnType<typeof findLoginByUserId>;
  try {
    const result = await makeVerifier(selfEndpoint(new URL(req.url).origin)).verify(
      attestationId as 1 | 2 | 3 | 4,
      proof as never,
      publicSignals as never,
      userContextData,
    );
    login = findLoginByUserId(result.userData.userIdentifier);
    if (!result.isValidDetails.isValid) {
      if (login) login.error = "Self could not verify the proof (age or document check failed).";
      return Response.json(
        { status: "error", result: false, reason: "verification failed", error_code: "VERIFICATION_FAILED", details: result.isValidDetails },
        { status: 200 },
      );
    }
    if (!login) return fail("This sign-in QR has expired. Reload the sign-in page and scan again.", "LOGIN_EXPIRED");

    const d = result.discloseOutput;
    const disclosed = Object.fromEntries(
      Object.entries({
        name: d.name,
        date_of_birth: d.dateOfBirth,
        nationality: d.nationality,
        gender: d.gender,
        expiry_date: d.expiryDate,
      }).filter(([, v]) => typeof v === "string" && v.length > 0),
    ) as Record<string, string>;

    const identity = await upsertIdentity({
      nullifier: String(d.nullifier),
      role: login.role,
      label: login.label,
      userId: result.userData.userIdentifier,
      attestationId,
      disclosed,
    });
    login.nullifier = identity.nullifier;

    return Response.json({
      status: "success",
      result: true,
      // Disclosed only; the Aadhaar number itself is never revealed.
      credentialSubject: result.discloseOutput,
      identity: { role: identity.role, label: identity.label, verifiedAt: identity.verifiedAt },
    });
  } catch (err) {
    const reason = (err as Error).message;
    if (login) login.error = reason;
    return fail(reason, err instanceof LabelTakenError ? "LABEL_TAKEN" : "UNKNOWN_ERROR");
  }
}
