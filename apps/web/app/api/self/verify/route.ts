import { AllIds, DefaultConfigStore, SelfBackendVerifier } from "@selfxyz/core";
import { upsertIdentity } from "@/lib/server/identity";
import { SELF_SCOPE, selfEndpoint, selfMock } from "@/lib/self-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * The Self offchain SDK's backend half. The Self phone app scans the desk's
 * QR, generates a zero-knowledge proof from the person's Aadhaar QR (or
 * passport) and POSTs it here. We verify the proof and store only what it
 * chose to disclose. Aadhaar is attestation id 3; no document data beyond
 * the disclosures ever reaches this server.
 *
 * Scope, endpoint and mock flag come from lib/self-config.ts, the same values
 * the QR was built with. NEXT_PUBLIC_SELF_MOCK=true (default) verifies against
 * Self's test mode (mock documents); false verifies real proofs.
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

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SelfProofBody;
  const { attestationId, proof, publicSignals, userContextData } = body;
  if (!proof || !publicSignals || !attestationId || !userContextData) {
    return Response.json(
      { status: "error", result: false, reason: "proof, publicSignals, attestationId and userContextData are required", error_code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  try {
    const result = await makeVerifier(selfEndpoint(new URL(req.url).origin)).verify(
      attestationId as 1 | 2 | 3 | 4,
      proof as never,
      publicSignals as never,
      userContextData,
    );
    if (!result.isValidDetails.isValid) {
      return Response.json(
        { status: "error", result: false, reason: "verification failed", error_code: "VERIFICATION_FAILED", details: result.isValidDetails },
        { status: 200 },
      );
    }

    // The desk page packed the role and label into the proof's user context.
    let role: "merchant" | "user" = "user";
    let label = "";
    try {
      const parsed = JSON.parse(result.userData.userDefinedData || "{}") as { role?: string; label?: string };
      if (parsed.role === "merchant") role = "merchant";
      label = (parsed.label ?? "").slice(0, 120);
    } catch {
      /* keep defaults */
    }

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
      role,
      label,
      userId: result.userData.userIdentifier,
      attestationId,
      disclosed,
    });

    return Response.json({
      status: "success",
      result: true,
      // Disclosed only; the Aadhaar number itself is never revealed.
      credentialSubject: result.discloseOutput,
      identity: { role, label, verifiedAt: identity.verifiedAt },
    });
  } catch (err) {
    return Response.json(
      { status: "error", result: false, reason: (err as Error).message, error_code: "UNKNOWN_ERROR" },
      { status: 200 },
    );
  }
}
