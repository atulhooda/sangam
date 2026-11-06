"use client";

import { useState, type FormEvent } from "react";
import { SangamTile } from "../components/space/kit";

type Role = "merchant" | "user";

/**
 * The sign-in screen: pick buyer or merchant, then a password right here, or
 * a Self proof (the QR comes next). One card, both ways in.
 */
export function SignInCard({
  role,
  onRole,
  onSelf,
  starting,
  notice,
  failed,
  selfTestMode,
}: {
  role: Role;
  onRole: (r: Role) => void;
  onSelf: () => void;
  starting: boolean;
  notice: string | null;
  failed: string | null;
  selfTestMode: boolean;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const merchant = role === "merchant";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(merchant ? "/api/auth/password" : "/api/auth/buyer-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(merchant ? { name, password } : { username: name, password }),
      });
      const data = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok || !data.redirect) throw new Error(data.error ?? `Sign-in failed (${res.status})`);
      window.location.href = data.redirect;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const switchRole = (r: Role) => {
    onRole(r);
    setName("");
    setError(null);
  };

  return (
    <div className="mx-auto w-full max-w-[420px] py-8 sm:py-14">
      <div className="text-center">
        <span className="inline-block">
          <SangamTile size={44} />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Sign in to Sangam</h1>
        <p className="mt-1.5 text-sm text-muted">{merchant ? "Your shop's desk: settlements, payouts and your ENS name." : "Your buyer desk: your agent, its wallet and its purchases."}</p>
      </div>

      <div className="mt-7 rounded-2xl border border-line bg-surface p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] sm:p-6">
        <div role="tablist" aria-label="Sign in as" className="grid grid-cols-2 gap-1 rounded-xl bg-surface2 p-1">
          {(["user", "merchant"] as const).map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={role === r}
              onClick={() => switchRole(r)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${role === r ? "bg-accent text-white shadow-sm dark:text-[#0b0d1a]" : "text-muted hover:text-ink"}`}
            >
              {r === "user" ? "Buyer" : "Merchant"}
            </button>
          ))}
        </div>

        {notice && <p className="mt-4 rounded-lg bg-warnbg/60 px-3 py-2 text-xs" role="status">{notice}</p>}

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div>
            <label htmlFor="signin-name" className="mb-1.5 block text-xs font-medium text-muted">
              {merchant ? "Shop name" : "Username"}
            </label>
            <div className="flex items-center rounded-xl border border-line bg-surface2 transition-colors focus-within:border-accent">
              <input
                id="signin-name"
                autoComplete="username"
                required
                value={name}
                onChange={(e) => setName(e.target.value.trim().toLowerCase())}
                className="mono min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-sm outline-none"
                placeholder={merchant ? "bakery" : "asha"}
              />
              {merchant && <span className="mono shrink-0 pr-3.5 text-sm text-muted">.sangam.eth</span>}
            </div>
          </div>
          <div>
            <label htmlFor="signin-password" className="mb-1.5 block text-xs font-medium text-muted">
              Password
            </label>
            <input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface2 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-accent"
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-badbg px-3 py-2 text-sm text-bad">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-muted">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <button
          onClick={onSelf}
          disabled={starting}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium transition-colors hover:border-accent disabled:opacity-60"
        >
          <QrIcon />
          {starting ? "Starting…" : "Continue with Self"}
        </button>
        <p className="mt-2 text-center text-xs text-muted">
          A zero-knowledge proof from your phone: Aadhaar or passport. Only your name and age leave it.
          {selfTestMode && " (Test mode: Self's mock documents.)"}
        </p>
        {failed && <p className="mt-3 rounded-lg bg-badbg px-3 py-2 text-sm text-bad" role="alert">{failed}</p>}
      </div>

      <p className="mt-5 text-center text-sm text-muted">
        {merchant ? (
          <>
            New shop?{" "}
            <a href="/verify?role=merchant&new=1" className="text-accent underline-offset-2 hover:underline">
              Verify with Self and claim your name
            </a>
          </>
        ) : (
          <>New here? Continue with Self: one scan and your agent is ready.</>
        )}
      </p>
    </div>
  );
}

function QrIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
    </svg>
  );
}
