"use client";

import { useEffect, useMemo, useState } from "react";
import { SelfAppBuilder, getUniversalLink } from "@selfxyz/qrcode";
import type { SelfApp } from "@selfxyz/qrcode";
import { SelfQRcodeWrapper } from "@selfxyz/qrcode/components/SelfQRcode";
import { ThemeToggle } from "../components/theme-toggle";

/*
 * The merchant & user desk. A person proves who they are with the Self
 * offchain SDK: pick a role, scan the QR with the Self phone app, and the app
 * builds a zero-knowledge proof from their Aadhaar QR (attestation id 3) —
 * age over 18 and the fields we ask for are revealed; the Aadhaar number
 * itself never is. The proof is verified server-side at /api/self/verify.
 *
 * Mock mode (SELF_MOCK, default true) uses Self's test documents, so this
 * works before any real deployment. For a real phone to reach the endpoint
 * it must be publicly reachable — deploy, or expose 5173 through a tunnel.
 */

const LOCALSTORAGE_KEY = "sangam.self.userId";

type Identity = {
  nullifier: string;
  role: "merchant" | "user";
  label: string;
  attestationId: number;
  disclosed: Record<string, string>;
  verifiedAt: string;
};

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</section>;
}

function CardHead({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

function LedgerRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="shrink-0 whitespace-nowrap text-sm text-muted">{k}</span>
      <span className="min-w-0 truncate text-right text-sm tabular-nums">{v}</span>
    </div>
  );
}

export default function VerifyPage() {
  const [role, setRole] = useState<"merchant" | "user">("merchant");
  const [label, setLabel] = useState("tickets.sangam.eth");
  const [selfApp, setSelfApp] = useState<SelfApp | null>(null);
  const [universalLink, setUniversalLink] = useState<string | null>(null);
  const [verified, setVerified] = useState<{ name?: string; role: string; label: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [identities, setIdentities] = useState<Identity[] | null>(null);

  const loadIdentities = () => {
    fetch("/api/self/identities", { cache: "no-store" })
      .then((r) => r.json() as Promise<Identity[]>)
      .then(setIdentities)
      .catch(() => setIdentities([]));
  };

  useEffect(() => {
    loadIdentities();
  }, []);

  // One stable identifier per browser so repeat verifications map to the same person.
  const userId = useMemo(() => {
    try {
      const existing = localStorage.getItem(LOCALSTORAGE_KEY);
      if (existing) return existing;
      const fresh = crypto.randomUUID();
      localStorage.setItem(LOCALSTORAGE_KEY, fresh);
      return fresh;
    } catch {
      return crypto.randomUUID();
    }
  }, []);

  // Rebuild the SelfApp whenever the role or label changes: the proof carries
  // both in its user context, so the backend can file the identity correctly.
  useEffect(() => {
    setFailed(null);
    setVerified(null);
    try {
      const endpoint = `${window.location.origin}/api/self/verify`;
      const app = new SelfAppBuilder({
        version: 2,
        appName: "Sangam",
        scope: "sangam",
        endpoint,
        endpointType: "staging_https", // offchain: proofs verify at our endpoint
        userId,
        userIdType: "uuid",
        userDefinedData: JSON.stringify({ role, label: label.trim() }),
        disclosures: { minimumAge: 18, name: true, date_of_birth: true },
      }).build();
      setSelfApp(app);
      setUniversalLink(getUniversalLink(app));
    } catch (err) {
      setFailed((err as Error).message);
    }
  }, [role, label, userId]);

  const load = identities?.length ?? 0;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <a href="/" className="text-lg font-bold tracking-tight text-accent">sangam</a>
            <span className="text-line">/</span>
            <span className="text-sm font-medium">Identity desk</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <a href="/dashboard" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink">
              Settlement desk →
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-5 py-6 sm:py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Who are you? Prove it with Aadhaar.</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Merchants and users of Sangam's AI-agent payments verify once with the Self offchain SDK. The proof is
            zero-knowledge: Sangam learns your name and that you're over 18 — never your Aadhaar number.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Card>
            <CardHead title="1 · Say who you are" hint="This travels inside the proof, signed." />
            <div className="space-y-3 px-5 py-4">
              <div className="grid grid-cols-2 gap-2">
                {(["merchant", "user"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
                      role === r ? "border-accent bg-accentbg/60" : "border-line bg-surface hover:border-accent/50"
                    }`}
                  >
                    {r === "merchant" ? "Merchant" : "User"}
                    <span className="block text-xs font-normal text-muted">
                      {r === "merchant" ? "I sell on Sangam / ONDC" : "I'm paying through an agent"}
                    </span>
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="text-xs text-muted">{role === "merchant" ? "Merchant ENS name" : "A label for yourself"}</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="mono mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent"
                  placeholder={role === "merchant" ? "myshop.sangam.eth" : "my name"}
                />
              </label>
            </div>
          </Card>

          <Card>
            <CardHead title="2 · Scan with the Self app" hint="The app proves your Aadhaar in zero knowledge." />
            <div className="flex flex-col items-center gap-3 px-5 py-5">
              {failed ? (
                <p className="rounded-lg bg-badbg p-3 text-sm text-bad">{failed}</p>
              ) : selfApp ? (
                <SelfQRcodeWrapper
                  selfApp={selfApp}
                  onSuccess={() => {
                    setVerified({ role, label: label.trim() });
                    loadIdentities();
                  }}
                  onError={(data) => setFailed(`verification failed: ${data.reason ?? data.error_code ?? "unknown"}`)}
                />
              ) : (
                <div className="flex h-64 w-64 animate-pulse items-center justify-center rounded-xl bg-surface2">
                  <p className="text-sm text-muted">Loading QR…</p>
                </div>
              )}
              {universalLink && (
                <a className="text-xs text-accent underline-offset-2 hover:underline" href={universalLink} target="_blank" rel="noreferrer">
                  or open on this phone ↗
                </a>
              )}
              {verified && (
                <p className="rounded-lg bg-okbg p-3 text-center text-sm text-ok" role="status">
                  ✓ Verified as {verified.role} {verified.label && `“${verified.label}”`} — filed on the desk.
                </p>
              )}
            </div>
          </Card>
        </div>

        <Card>
          <CardHead title="Verified identities" hint="Only what the proofs disclosed — no document numbers, ever." right={<span className="text-xs text-muted">{load} verified</span>} />
          <div className="px-5 py-3">
            {identities === null ? (
              <p className="py-4 text-sm text-muted">Loading…</p>
            ) : identities.length === 0 ? (
              <p className="py-4 text-sm text-muted">No one has verified yet. Scan the QR above to be the first.</p>
            ) : (
              <div className="rounded-lg bg-surface2 px-3 py-1">
                {identities.map((i) => (
                  <LedgerRow
                    key={i.nullifier}
                    k={`${i.role === "merchant" ? "Merchant" : "User"}${i.label ? ` · ${i.label}` : ""}`}
                    v={
                      <span className="flex items-center justify-end gap-2">
                        <span className="text-xs">{i.disclosed.name ?? "name withheld"}</span>
                        <span className="rounded-md bg-okbg px-1.5 py-px text-[10px] font-semibold text-ok">Aadhaar ✓</span>
                      </span>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
