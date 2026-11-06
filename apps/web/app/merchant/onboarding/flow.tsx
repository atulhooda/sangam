"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Me } from "@/lib/types";
import { Card, Spinner, idBadge } from "../../components/ui";
import { Logo } from "../../components/space/kit";
import { AccountMenu } from "../../components/account-menu";

type NameCheck = { label: string; name: string; available: boolean; reason: string | null; suggestions: string[]; error?: string };

const input = "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm outline-none transition focus:border-accent";

/** Self proof (done) → claim a name → set a password. */
export function OnboardingFlow({ me, step, pendingName, setupError }: { me: Me; step: "claim" | "password"; pendingName: string | null; setupError: string | null }) {
  const badge = idBadge(me.attestationId);
  return (
    <div className="min-h-screen">
      <header className="space-bar sticky top-3 z-40">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <a href="/" aria-label="Sangam home">
              <Logo />
            </a>
            <span className="text-line">/</span>
            <span className="text-sm font-medium">Merchant onboarding</span>
          </div>
          <AccountMenu me={me} />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-md space-y-5 px-5 py-8 sm:py-12">
        <Steps current={step === "claim" ? 2 : 3} />
        <p className="text-center text-sm text-muted">
          <span className={`rounded-md px-1.5 py-px text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span> Verified with Self
          {me.name ? ` as ${me.name}` : ""}.
        </p>
        {step === "claim" ? <ClaimName pendingName={pendingName} setupError={setupError} /> : <SetPassword name={me.label} />}
      </main>
    </div>
  );
}

function Steps({ current }: { current: 2 | 3 }) {
  const steps = ["Verify with Self", "Claim your name", "Set a password"];
  return (
    <ol className="flex items-center justify-center gap-2 text-xs">
      {steps.map((s, i) => {
        const n = i + 1;
        const done = n < current;
        const on = n === current;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold ${done ? "bg-okbg text-ok" : on ? "bg-accent text-white dark:text-[#0b0d1a]" : "bg-surface2 text-muted"}`}
            >
              {done ? "✓" : n}
            </span>
            <span className={on ? "font-medium" : "text-muted"}>{s}</span>
            {n < steps.length && <span className="text-line">—</span>}
          </li>
        );
      })}
    </ol>
  );
}

function ClaimName({ pendingName, setupError }: { pendingName: string | null; setupError: string | null }) {
  const [label, setLabel] = useState(pendingName ? pendingName.replace(/\.sangam\.eth$/, "") : "");
  const [check, setCheck] = useState<NameCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [upi, setUpi] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(setupError);
  const seq = useRef(0);
  const locked = !!pendingName; // setup failed earlier: retry with the name already held

  // Live availability: ask ENS 400 ms after the last keystroke.
  useEffect(() => {
    if (locked) return;
    const l = label.trim();
    if (l.length < 3) {
      setCheck(null);
      return;
    }
    const mine = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/merchant/name?label=${encodeURIComponent(l)}`, { cache: "no-store" });
        const body = (await res.json()) as NameCheck;
        if (mine === seq.current) setCheck(res.ok ? body : { ...body, available: false, reason: body.error ?? "Could not check that name", suggestions: [] });
      } finally {
        if (mine === seq.current) setChecking(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [label, locked]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/merchant/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, upiHandle: upi, priceInr: price }) });
      const body = (await res.json()) as { ok?: boolean; error?: string; check?: NameCheck };
      if (body.check) setCheck(body.check);
      if (!res.ok || !body.ok) throw new Error(body.error ?? `Could not claim the name (${res.status})`);
      window.location.reload(); // → step 3
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const free = locked || (check?.available && check.label === label.trim());
  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold tracking-tight">Claim your shop name</h1>
      <p className="mt-1.5 text-sm text-muted">
        It becomes your name on ENS, marked verified. Buyers&apos; agents find you by it and check every bill against it, so no one can bill more in your name.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="claim-name" className="mb-1.5 block text-xs font-medium text-muted">
            Shop name
          </label>
          <div className={`flex items-center rounded-xl border bg-white/[0.04] focus-within:border-accent ${check && !check.available ? "border-bad/60" : "border-white/10"}`}>
            <input
              id="claim-name"
              autoFocus={!locked}
              required
              disabled={locked || busy}
              value={label}
              onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              className="mono min-w-0 flex-1 bg-transparent px-4 py-3 text-sm outline-none disabled:opacity-70"
              placeholder="riya-sweets"
              maxLength={63}
            />
            <span className="mono shrink-0 pr-4 text-sm text-muted">.sangam.eth</span>
          </div>
          <div className="mt-2 min-h-5 text-xs" aria-live="polite">
            {locked ? (
              <span className="text-muted">Yours. Finish the setup to publish it.</span>
            ) : checking ? (
              <span className="flex items-center gap-1.5 text-muted">
                <Spinner className="h-3 w-3" /> Checking ENS…
              </span>
            ) : check && check.label === label.trim() ? (
              check.available ? (
                <span className="text-ok">✓ {check.name} is available</span>
              ) : (
                <span className="text-bad">
                  {check.reason}
                  {check.suggestions.length > 0 && (
                    <span className="mt-2 flex flex-wrap items-center gap-1.5 text-muted">
                      Try:
                      {check.suggestions.map((s) => (
                        <button key={s} type="button" onClick={() => setLabel(s)} className="mono rounded-full border border-line px-2.5 py-1 text-[11px] text-ink transition-colors hover:border-accent">
                          {s}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              )
            ) : label.trim().length > 0 && label.trim().length < 3 ? (
              <span className="text-muted">At least 3 characters.</span>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.4fr_1fr]">
          <div>
            <label htmlFor="claim-upi" className="mb-1.5 block text-xs font-medium text-muted">
              UPI handle for payouts
            </label>
            <input id="claim-upi" required value={upi} onChange={(e) => setUpi(e.target.value.trim())} className={`${input} mono`} placeholder="myshop@okaxis" maxLength={97} disabled={busy} />
          </div>
          <div>
            <label htmlFor="claim-price" className="mb-1.5 block text-xs font-medium text-muted">
              Pay-link price (₹)
            </label>
            <input id="claim-price" required type="number" min={1} max={100000} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={input} placeholder="100" disabled={busy} />
          </div>
        </div>
        <p className="text-[11px] text-muted">You&apos;ll add every product with its own price on your desk next; the pay-link price is for payments that aren&apos;t a product.</p>
        {error && (
          <p role="alert" className="rounded-lg bg-badbg px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        <button disabled={busy || !free} className="w-full rounded-full bg-accent px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]">
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Spinner className="h-4 w-4" /> Publishing on ENS… (up to a minute)
            </span>
          ) : locked ? (
            "Finish setting up →"
          ) : (
            "Claim this name →"
          )}
        </button>
      </form>
    </Card>
  );
}

function SetPassword({ name }: { name: string }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw !== again) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/merchant/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
      const body = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok || !body.redirect) throw new Error(body.error ?? `Could not save the password (${res.status})`);
      window.location.href = body.redirect;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <p className="rounded-lg bg-okbg px-3 py-2 text-sm text-ok">
        ✓ <span className="mono">{name}</span> is yours, live on ENS.
      </p>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">Set a password</h1>
      <p className="mt-1.5 text-sm text-muted">
        Sign in with <span className="mono text-ink">{name.replace(/\.sangam\.eth$/, "")}</span> and this password from now on. Signing in with Self keeps working too.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input type="text" autoComplete="username" value={name} readOnly hidden />
        <div>
          <label htmlFor="pw" className="mb-1.5 block text-xs font-medium text-muted">
            Password (8+ characters)
          </label>
          <input id="pw" type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} className={input} autoFocus />
        </div>
        <div>
          <label htmlFor="pw2" className="mb-1.5 block text-xs font-medium text-muted">
            Same again
          </label>
          <input id="pw2" type="password" autoComplete="new-password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} className={input} />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-badbg px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        <button disabled={busy} className="w-full rounded-full bg-accent px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]">
          {busy ? "Saving…" : "Save and open my desk →"}
        </button>
      </form>
    </Card>
  );
}
