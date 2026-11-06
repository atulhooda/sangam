"use client";

import { useState, type FormEvent } from "react";
import { Card } from "../../components/ui";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/demo-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
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
      <h1 className="text-xl font-semibold tracking-tight">Sign in to a demo merchant</h1>
      <p className="mt-1.5 text-sm text-muted">
        For the railway shop and the bakery, whose ENS names Sangam issued itself. Real merchants sign in with Self at{" "}
        <a href="/verify?role=merchant" className="text-accent underline-offset-2 hover:underline">/verify</a>.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="demo-username" className="mb-1.5 block text-xs font-medium text-muted">Username</label>
          <input id="demo-username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} className={input} placeholder="railkart" />
        </div>
        <div>
          <label htmlFor="demo-password" className="mb-1.5 block text-xs font-medium text-muted">Password</label>
          <input id="demo-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
        </div>
        {error && <p role="alert" className="rounded-lg bg-badbg px-3 py-2 text-sm text-bad">{error}</p>}
        <button disabled={busy} className="w-full rounded-full bg-accent px-6 py-3 font-medium text-[#0b0d1a] transition-opacity hover:opacity-90 disabled:opacity-60">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Card>
  );
}
