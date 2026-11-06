"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SelfAppBuilder, getUniversalLink } from "@selfxyz/qrcode";
import type { SelfApp } from "@selfxyz/qrcode";
import { SelfQRcodeWrapper } from "@selfxyz/qrcode/components/SelfQRcode";
import type { Me } from "@/lib/types";
import { Card, CardHead, Spinner } from "../components/ui";
import { Logo } from "../components/space/kit";
import { AccountMenu } from "../components/account-menu";
import { SELF_SCOPE, selfEndpoint, selfMock } from "@/lib/self-config";

/*
 * Sign in with Self. No passwords, no wallet:
 *
 *   1. login    "Continue with Self" (or "you're signed in" for a returning browser)
 *   2. role     merchant or buyer
 *   3. details  merchants only: the ENS name agents pay
 *   4. scan     POST /api/auth/start gives this browser a one-time QR id and
 *               an httpOnly cookie; the phone proves; this page polls
 *               /api/auth/complete until the server hands over the session
 *
 * Buyers are done after the scan. Merchants go on to upload a company
 * certificate (/merchant/onboarding) before their desk opens.
 *
 * Mock mode (NEXT_PUBLIC_SELF_MOCK, default true) uses Self's test documents;
 * live mode (false) needs a public https endpoint. See lib/self-config.ts.
 */

type Role = "merchant" | "user";
type Step = "login" | "role" | "scan";
type Claim = { status: "pending" } | { status: "signed-in"; redirect: string } | { status: "error" | "expired"; reason: string };

export default function VerifyPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = checking
  const [step, setStep] = useState<Step>("login");
  const [role, setRole] = useState<Role>("user");
  const [label, setLabel] = useState("");
  const [selfApp, setSelfApp] = useState<SelfApp | null>(null);
  const [universalLink, setUniversalLink] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const claiming = useRef(false);

  // Who's here already, and did a desk send them (?role=merchant&label=…)?
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ signedIn: boolean; me?: Me }>)
      .then((r) => setMe(r.signedIn && r.me ? r.me : null))
      .catch(() => setMe(null));
    const q = new URLSearchParams(window.location.search);
    const r = q.get("role");
    if (r === "merchant" || r === "user") setRole(r);
    if (q.get("label")) setLabel(q.get("label")!);
    if (r === "merchant" && q.get("new")) setNotice("New merchant: verify with Self, then claim your shop name.");
    else if (r === "merchant") setNotice("Sign in as the merchant to open that desk.");
    else if (r === "user") setNotice("Sign in as a buyer to open the buyer desk.");
  }, []);

  const begin = useCallback(async (r: Role, l: string) => {
    setStarting(true);
    setFailed(null);
    setDone(false);
    setSelfApp(null);
    setUniversalLink(null);
    try {
      const res = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: r, label: l }),
      });
      const body = (await res.json()) as { userId?: string; label?: string; error?: string };
      if (!res.ok || !body.userId) throw new Error(body.error ?? `Could not start sign-in (${res.status})`);
      const app = new SelfAppBuilder({
        version: 2,
        appName: "Sangam",
        scope: SELF_SCOPE,
        endpoint: selfEndpoint(window.location.origin),
        // Offchain: proofs verify at our endpoint. Must match the server's mock flag.
        endpointType: selfMock() ? "staging_https" : "https",
        userId: body.userId,
        userIdType: "uuid",
        // Informational only: the server takes role and name from the sign-in it issued.
        userDefinedData: JSON.stringify({ role: r, label: body.label ?? "" }),
        disclosures: { minimumAge: 18, name: true, date_of_birth: true },
      }).build();
      setSelfApp(app);
      setUniversalLink(getUniversalLink(app));
      setStep("scan");
    } catch (err) {
      setFailed((err as Error).message);
    } finally {
      setStarting(false);
    }
  }, []);

  // Ask the server whether this browser's sign-in has been verified.
  const claim = useCallback(async () => {
    if (claiming.current) return;
    claiming.current = true;
    try {
      const res = await fetch("/api/auth/complete", { method: "POST" });
      const body = (await res.json()) as Claim;
      if (body.status === "signed-in") {
        setDone(true);
        window.location.href = body.redirect;
      } else if (body.status === "error" || body.status === "expired") {
        setFailed(body.reason);
        setSelfApp(null);
      }
    } catch {
      /* keep polling */
    } finally {
      claiming.current = false;
    }
  }, []);

  // While the QR is up, poll in case the Self relay's success event is missed.
  useEffect(() => {
    if (step !== "scan" || !selfApp || done || failed) return;
    const t = setInterval(claim, 2000);
    return () => clearInterval(t);
  }, [step, selfApp, done, failed, claim]);

  const choose = (r: Role) => {
    setRole(r);
    void begin(r, "");
  };

  return (
    <div className="min-h-screen">
      <header className="space-bar sticky top-3 z-40">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <a href="/" aria-label="Sangam home"><Logo /></a>
            <span className="text-line">/</span>
            <span className="text-sm font-medium">Sign in</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="hidden rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink sm:block">
              Settlement desk →
            </a>
            {me && <AccountMenu me={me} />}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-5 py-6 sm:py-8">
        {/* ── screen 1: login ── */}
        {step === "login" && (
          <div className="mx-auto max-w-md py-10 text-center sm:py-16">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-3xl font-bold text-white dark:text-[#0b0d1a]">सं</div>
            <h1 className="mt-6 text-3xl font-bold tracking-tight">Sign in to Sangam</h1>
            <p className="mt-2 text-sm text-muted">
              No passwords, no wallet. One zero-knowledge proof from your phone — an Aadhaar in India, a passport
              anywhere else. Sangam learns your name and that you're over 18; nothing else about you leaves your
              device.
            </p>
            {notice && !me && <p className="mt-4 rounded-lg bg-warnbg/60 p-3 text-sm" role="status">{notice}</p>}

            {me === undefined ? (
              <p className="mt-8 flex items-center justify-center gap-2 text-sm text-muted"><Spinner /> Checking…</p>
            ) : me ? (
              <div className="mt-8 rounded-xl border border-line bg-surface p-5 text-sm" role="status">
                <p className="font-medium">
                  You're signed in as {me.role === "merchant" ? `merchant ${me.label}` : "a buyer"}
                  {me.name ? ` — ${me.name}` : ""}.
                </p>
                <a
                  className="mt-4 inline-block w-full rounded-full bg-accent px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 dark:text-[#0b0d1a]"
                  href={me.home}
                >
                  {me.role === "merchant" ? (me.home.startsWith("/merchant/onboarding") ? "Finish merchant onboarding →" : "Go to my merchant desk →") : "Go to my buyer desk →"}
                </a>
                {me.switchTo ? (
                  <p className="mt-3 text-xs text-muted">
                    You've also verified as a {me.switchTo === "merchant" ? "merchant" : "buyer"} here: use <span className="font-medium">Switch</span> at the top right, no scan needed.
                  </p>
                ) : (
                  <button
                    onClick={() => (me.role === "merchant" ? choose("user") : choose("merchant"))}
                    className="mt-3 text-xs text-accent underline-offset-2 hover:underline"
                  >
                    Also use Sangam as a {me.role === "merchant" ? "buyer" : "merchant"} (one more Self scan, then switch any time) →
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={() => (notice && role === "merchant" ? choose("merchant") : setStep("role"))}
                className="mt-8 w-full rounded-full bg-accent px-6 py-4 font-medium text-white transition-opacity hover:opacity-90 dark:text-[#0b0d1a]"
              >
                Continue with Self →
              </button>
            )}
            {!me && (
              <a href="/merchant/login" className="mt-4 block text-sm text-accent underline-offset-2 hover:underline">
                Merchant with a password? Sign in with your shop name →
              </a>
            )}
            {!me && (
              <a href="/buyer/login" className="mt-2 block text-sm text-accent underline-offset-2 hover:underline">
                Buyer with a password? Sign in with your username →
              </a>
            )}
            <p className="mt-6 text-xs text-muted">
              The proof is verified at <span className="mono">/api/self/verify</span> and only the disclosed fields are stored.
              {selfMock() && " Test mode: use the Self app's mock documents."}
            </p>
          </div>
        )}

        {/* ── screen 2: who are you ── */}
        {step === "role" && (
          <div className="mx-auto max-w-2xl py-6 text-center sm:py-10">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Step 1</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">How are you using Sangam?</h1>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <button onClick={() => choose("merchant")} className="group rounded-2xl border border-line bg-surface p-6 text-left transition-colors hover:border-accent">
                <span aria-hidden className="text-3xl">🏪</span>
                <p className="mt-3 text-lg font-semibold">I'm a merchant</p>
                <p className="mt-1 text-sm text-muted">Agents pay me in stablecoins, I get rupees over UPI. Verify with Self, then claim my shop name on ENS.</p>
                <p className="mt-3 text-xs font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">Continue →</p>
              </button>
              <button onClick={() => choose("user")} disabled={starting} className="group rounded-2xl border border-line bg-surface p-6 text-left transition-colors hover:border-accent disabled:opacity-60">
                <span aria-hidden className="text-3xl">🤖</span>
                <p className="mt-3 text-lg font-semibold">I'm a buyer</p>
                <p className="mt-1 text-sm text-muted">My AI agent buys for me with USDC. Just one Self proof — nothing else to fill in.</p>
                <p className="mt-3 text-xs font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">{starting ? "Starting…" : "Continue →"}</p>
              </button>
            </div>
            {failed && <p className="mt-6 rounded-lg bg-badbg p-3 text-sm text-bad" role="alert">{failed}</p>}
            <button onClick={() => setStep("login")} className="mt-8 text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
              ← Back
            </button>
          </div>
        )}

        {/* ── screen 4: the Self QR ── */}
        {step === "scan" && (
          <div className="mx-auto max-w-md space-y-5 py-2 sm:py-6">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{role === "merchant" ? "Merchant · step 1 of 3" : "Buyer · last step"}</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Scan with the Self app</h1>
              <p className="mt-2 text-sm text-muted">
                {role === "merchant" ? <>Proving who runs the shop. Next you claim its name. </> : null}
                Aadhaar in India, a passport anywhere else.
              </p>
            </div>

            <Card>
              <CardHead title="Self QR" hint="Works once, for this browser only, for 10 minutes." />
              <div className="flex flex-col items-center gap-3 px-5 py-5">
                {failed ? (
                  <>
                    <p className="rounded-lg bg-badbg p-3 text-center text-sm text-bad" role="alert">{failed}</p>
                    <button onClick={() => void begin(role, label)} className="text-sm text-accent underline-offset-2 hover:underline">
                      Get a new QR
                    </button>
                  </>
                ) : done ? (
                  <p className="flex items-center gap-2 rounded-lg bg-okbg p-3 text-sm text-ok" role="status"><Spinner /> Verified — signing you in…</p>
                ) : selfApp ? (
                  <>
                    <SelfQRcodeWrapper
                      selfApp={selfApp}
                      onSuccess={() => void claim()}
                      onError={(data) => setFailed(`Verification failed: ${data.reason ?? data.error_code ?? "unknown"}`)}
                    />
                    {universalLink && (
                      <a className="text-xs text-accent underline-offset-2 hover:underline" href={universalLink} target="_blank" rel="noreferrer">
                        or open on this phone ↗
                      </a>
                    )}
                    <p className="flex items-center gap-2 text-xs text-muted"><Spinner className="h-3 w-3" /> Waiting for your phone…</p>
                  </>
                ) : (
                  <div className="flex h-64 w-64 animate-pulse items-center justify-center rounded-xl bg-surface2">
                    <p className="text-sm text-muted">Loading QR…</p>
                  </div>
                )}
              </div>
            </Card>

            <div className="text-center">
              <button
                onClick={() => {
                  setFailed(null);
                  setSelfApp(null);
                  setStep("role");
                }}
                className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                ← Back
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
