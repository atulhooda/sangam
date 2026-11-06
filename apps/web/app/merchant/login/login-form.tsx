"use client";

import { useState, type FormEvent } from "react";
import { Card } from "../../components/ui";

export function LoginForm() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, password }) });
      const data = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok || !data.redirect) throw new Error(data.error ?? `Sign-in failed (${res.status})`);
      window.location.href = data.redirect;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm outline-none transition focus:border-accent";
  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold tracking-tight">Merchant sign-in</h1>
      <p className="mt-1.5 text-sm text-muted">Your shop name and the password you set after verifying with Self.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="shop-name" className="mb-1.5 block text-xs font-medium text-muted">
            Shop name
          </label>
          <div className="flex items-center rounded-xl border border-white/10 bg-white/[0.04] focus-within:border-accent">
            <input
              id="shop-name"
              autoComplete="username"
              required
              value={name}
              onChange={(e) => setName(e.target.value.trim().toLowerCase())}
              className="mono min-w-0 flex-1 bg-transparent px-4 py-3 text-sm outline-none"
              placeholder="riya-sweets"
            />
            <span className="mono shrink-0 pr-4 text-sm text-muted">.sangam.eth</span>
          </div>
        </div>
        <div>
          <label htmlFor="shop-password" className="mb-1.5 block text-xs font-medium text-muted">
            Password
          </label>
          <input id="shop-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-badbg px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        <button disabled={busy} className="w-full rounded-full bg-accent px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="mt-5 space-y-1.5 border-t border-line pt-4 text-sm text-muted">
        <p>
          Forgot it, or prefer your phone?{" "}
          <a href="/verify?role=merchant" className="text-accent underline-offset-2 hover:underline">
            Sign in with Self →
          </a>
        </p>
        <p>
          New merchant?{" "}
          <a href="/verify?role=merchant&new=1" className="text-accent underline-offset-2 hover:underline">
            Verify with Self and claim your name →
          </a>
        </p>
      </div>
    </Card>
  );
}
