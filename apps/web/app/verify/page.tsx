"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SelfAppBuilder, getUniversalLink } from "@selfxyz/qrcode";
import type { SelfApp } from "@selfxyz/qrcode";
import { SelfQRcodeWrapper } from "@selfxyz/qrcode/components/SelfQRcode";
import { Card, CardHead, LedgerRow, idBadge } from "../components/ui";
import { ThemeToggle } from "../components/theme-toggle";
import { SELF_SCOPE, selfEndpoint, selfMock } from "@/lib/self-config";

/*
 * Sign-in, Sangam-style. Three screens:
 *
 *   1. login   — "Continue with Self". No passwords: your identity is a
 *                zero-knowledge proof made by the Self phone app.
 *   2. role    — Merchant or Buyer.
 *   3. scan    — the Self QR. Aadhaar for Indians, a passport for everyone
 *                else (all credentials accepted); only name + over-18 are
 *                revealed, never a document number. On success you land on
 *                your desk.
 *
 * Returning users are recognised by the identifier in this browser and sent
 * straight to their desk from screen 1.
 *
 * Mock mode (NEXT_PUBLIC_SELF_MOCK, default true) uses Self's test documents,
 * so this works before any real deployment. Live mode (false) needs the
 * endpoint publicly reachable over https — see lib/self-config.ts.
 */

const LOCALSTORAGE_KEY = "sangam.self.userId";

type Role = "merchant" | "user";
type Step = "login" | "role" | "scan";

type Identity = {
  nullifier: string;
  role: Role;
  label: string;
  userId: string;
  attestationId: number;
  disclosed: Record<string, string>;
  verifiedAt: string;
};

const deskHref = (i: Pick<Identity, "role" | "label">) =>
  i.role === "merchant" && i.label ? `/merchant/${encodeURIComponent(i.label)}` : "/buyer";

export default function VerifyPage() {
  const [step, setStep] = useState<Step>("login");
  const [role, setRole] = useState<Role>("merchant");
  const [label, setLabel] = useState("tickets.sangam.eth");
  const [selfApp, setSelfApp] = useState<SelfApp | null>(null);
  const [universalLink, setUniversalLink] = useState<string | null>(null);
  const [verified, setVerified] = useState<{ role: Role; label: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [identities, setIdentities] = useState<Identity[] | null>(null);
  const [returning, setReturning] = useState<Identity | null | undefined>(undefined); // undefined = checking

  const loadIdentities = useCallback(() => {
    fetch("/api/self/identities", { cache: "no-store" })
      .then((r) => r.json() as Promise<Identity[]>)
      .then(setIdentities)
      .catch(() => setIdentities([]));
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

  useEffect(() => {
    loadIdentities();
  }, [loadIdentities]);

  // Returning user? If this browser's identifier has a verified identity,
  // screen 1 offers the desk directly.
  useEffect(() => {
    if (identities === null) return;
    try {
      const mine = localStorage.getItem(LOCALSTORAGE_KEY);
      setReturning((mine && identities.find((i) => i.userId === mine)) || null);
    } catch {
      setReturning(null);
    }
  }, [identities]);

  // Rebuild the SelfApp whenever the role or label changes: the proof carries
  // both in its user context, so the backend can file the identity correctly.
  useEffect(() => {
    if (step !== "scan") return;
    setFailed(null);
    setVerified(null);
    try {
      const app = new SelfAppBuilder({
        version: 2,
        appName: "Sangam",
        scope: SELF_SCOPE,
        endpoint: selfEndpoint(window.location.origin),
        // Offchain: proofs verify at our endpoint. Must match the server's mock flag.
        endpointType: selfMock() ? "staging_https" : "https",
        userId,
        userIdType: "uuid",
        userDefinedData: JSON.stringify({ role, label: role === "merchant" ? label.trim() : "" }),
        disclosures: { minimumAge: 18, name: true, date_of_birth: true },
      }).build();
      setSelfApp(app);
      setUniversalLink(getUniversalLink(app));
    } catch (err) {
      setFailed((err as Error).message);
    }
  }, [step, role, label, userId]);

  const load = identities?.length ?? 0;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <a href="/" className="text-lg font-bold tracking-tight text-accent">sangam</a>
            <span className="text-line">/</span>
            <span className="text-sm font-medium">Sign in</span>
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
        {/* ── screen 1: login ── */}
        {step === "login" && (
          <div className="mx-auto max-w-md py-10 text-center sm:py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent mx-auto text-3xl font-bold text-white dark:text-[#1a1917]">सं</div>
            <h1 className="mt-6 text-3xl font-bold tracking-tight">Sign in to Sangam</h1>
            <p className="mt-2 text-sm text-muted">
              No passwords, no wallet. One zero-knowledge proof from your phone — an Aadhaar in India, a passport
              anywhere else. Sangam learns your name and that you're over 18; nothing else about you leaves your
              device.
            </p>
            <button
              onClick={() => setStep("role")}
              disabled={returning === undefined}
              className="mt-8 w-full rounded-xl bg-accent px-6 py-4 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#1a1917]"
            >
              {returning === undefined ? "Checking…" : "Continue with Self →"}
            </button>
            {returning && (
              <div className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm" role="status">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  Welcome back
                  <span className={`rounded-md px-1.5 py-px text-[10px] font-semibold ${idBadge(returning.attestationId).cls}`}>{idBadge(returning.attestationId).label}</span>
                </span>
                <p className="mt-1 text-xs text-muted">
                  You're registered as {returning.role === "merchant" ? "a merchant" : "a buyer"}
                  {returning.label ? ` — ${returning.label}` : ""}.
                </p>
                <a
                  className="mt-3 inline-block rounded-lg bg-ok px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 dark:text-[#1a1917]"
                  href={deskHref(returning)}
                >
                  Go to your {returning.role === "merchant" ? "merchant desk" : "buyer desk"} →
                </a>
              </div>
            )}
            <p className="mt-6 text-xs text-muted">
              By continuing you prove your identity with the Self offchain SDK — the proof is verified at
              <span className="mono"> /api/self/verify</span> and only the disclosed fields are stored.
            </p>
          </div>
        )}

        {/* ── screen 2: who are you ── */}
        {step === "role" && (
          <div className="mx-auto max-w-2xl py-6 text-center sm:py-10">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Step 1 of 2</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">How are you using Sangam?</h1>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <button
                onClick={() => {
                  setRole("merchant");
                  setStep("scan");
                }}
                className="group rounded-2xl border border-line bg-surface p-6 text-left transition-colors hover:border-accent"
              >
                <span aria-hidden className="text-3xl">🏪</span>
                <p className="mt-3 text-lg font-semibold">I'm a merchant</p>
                <p className="mt-1 text-sm text-muted">I sell on Sangam or ONDC. Agents pay me in USDC, I get rupees over UPI.</p>
                <p className="mt-3 text-xs font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">Continue →</p>
              </button>
              <button
                onClick={() => {
                  setRole("user");
                  setStep("scan");
                }}
                className="group rounded-2xl border border-line bg-surface p-6 text-left transition-colors hover:border-accent"
              >
                <span aria-hidden className="text-3xl">🤖</span>
                <p className="mt-3 text-lg font-semibold">I'm a buyer</p>
                <p className="mt-1 text-sm text-muted">My AI agent buys for me — tickets, ONDC goods — with USDC, no approval steps.</p>
                <p className="mt-3 text-xs font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">Continue →</p>
              </button>
            </div>
            <button onClick={() => setStep("login")} className="mt-8 text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
              ← Back
            </button>
          </div>
        )}

        {/* ── screen 3: the Self QR ── */}
        {step === "scan" && (
          <div className="mx-auto max-w-2xl space-y-5 py-2 sm:py-6">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Step 2 of 2</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                {role === "merchant" ? "Verify your identity to open your merchant desk" : "Verify your identity to open your buyer desk"}
              </h1>
              <p className="mt-2 text-sm text-muted">Scan with the Self app. {role === "merchant" ? "Aadhaar (India) or a passport anywhere else." : "Aadhaar (India) or a passport anywhere else."}</p>
            </div>

            <Card>
              <CardHead
                title={role === "merchant" ? "Your merchant name" : "Ready to scan"}
                hint={role === "merchant" ? "The ENS name agents will pay. It travels inside the proof, signed." : "No details needed — the QR is tied to this browser."}
              />
              <div className="px-5 py-4">
                {role === "merchant" && (
                  <label className="block">
                    <span className="text-xs text-muted">Merchant ENS name</span>
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      className="mono mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent"
                      placeholder="myshop.sangam.eth"
                    />
                  </label>
                )}
              </div>
            </Card>

            <Card>
              <CardHead title="Scan with the Self app" hint="The app builds the proof on your phone." />
              <div className="flex flex-col items-center gap-3 px-5 py-5">
                {failed ? (
                  <>
                    <p className="rounded-lg bg-badbg p-3 text-sm text-bad">{failed}</p>
                    <button onClick={() => setFailed(null)} className="text-xs text-accent underline-offset-2 hover:underline">
                      Try again
                    </button>
                  </>
                ) : selfApp ? (
                  <SelfQRcodeWrapper
                    selfApp={selfApp}
                    onSuccess={() => {
                      setVerified({ role, label: role === "merchant" ? label.trim() : "" });
                      loadIdentities();
                    }}
                    onError={(data) => setFailed(`verification failed: ${data.reason ?? data.error_code ?? "unknown"}`)}
                  />
                ) : (
                  <div className="flex h-64 w-64 animate-pulse items-center justify-center rounded-xl bg-surface2">
                    <p className="text-sm text-muted">Loading QR…</p>
                  </div>
                )}
                {universalLink && !verified && (
                  <a className="text-xs text-accent underline-offset-2 hover:underline" href={universalLink} target="_blank" rel="noreferrer">
                    or open on this phone ↗
                  </a>
                )}
                {verified && (
                  <div className="rounded-lg bg-okbg p-3 text-center text-sm text-ok" role="status">
                    ✓ Registered as {verified.role === "merchant" ? "a merchant" : "a buyer"}
                    {verified.label ? ` — ${verified.label}` : ""}
                    <div className="mt-2">
                      <a
                        className="inline-block rounded-lg bg-ok px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 dark:text-[#1a1917]"
                        href={deskHref(verified)}
                      >
                        Go to your {verified.role === "merchant" ? "merchant desk" : "buyer desk"} →
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <div className="text-center">
              <button onClick={() => setStep("role")} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
                ← I'm not a {role === "merchant" ? "merchant" : "buyer"}
              </button>
            </div>
          </div>
        )}

        <Card className="mx-auto max-w-5xl">
          <CardHead title="Registered identities" hint="Only what the proofs disclosed — no document numbers, ever." right={<span className="text-xs text-muted">{load} registered</span>} />
          <div className="px-5 py-3">
            {identities === null ? (
              <p className="py-4 text-sm text-muted">Loading…</p>
            ) : identities.length === 0 ? (
              <p className="py-4 text-sm text-muted">No one has registered yet. Continue with Self above to be the first.</p>
            ) : (
              <div className="rounded-lg bg-surface2 px-3 py-1">
                {identities.map((i) => (
                  <LedgerRow
                    key={i.nullifier}
                    k={
                      <a className="hover:underline" href={deskHref(i)}>
                        {i.role === "merchant" ? "Merchant" : "User"}{i.label ? ` · ${i.label}` : ""} ↗
                      </a>
                    }
                    v={
                      <span className="flex items-center justify-end gap-2">
                        <span className="text-xs">{i.disclosed.name ?? "name withheld"}</span>
                        <span className={`rounded-md px-1.5 py-px text-[10px] font-semibold ${idBadge(i.attestationId).cls}`}>{idBadge(i.attestationId).label}</span>
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
