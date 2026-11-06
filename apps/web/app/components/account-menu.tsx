"use client";

import { useEffect, useState } from "react";
import type { Me } from "@/lib/types";
import { idBadge } from "./ui";

/**
 * Header account control, on every page: "Sign in" when signed out; the
 * person's name, role, a Switch button (when this browser has proven both
 * roles) and Sign out. Pages that already know the session pass it in; it
 * still pings /api/auth/me once, which keeps the 30-day session renewed.
 */
export function AccountMenu({ me: initial }: { me?: Me | null }) {
  const [me, setMe] = useState<Me | null | undefined>(initial);
  const [busy, setBusy] = useState<"out" | "switch" | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ signedIn: boolean; me?: Me }>)
      .then((r) => {
        if (initial === undefined) setMe(r.signedIn && r.me ? r.me : null);
      })
      .catch(() => {
        if (initial === undefined) setMe(null);
      });
  }, [initial]);

  async function switchTo(role: "merchant" | "user") {
    setBusy("switch");
    try {
      const res = await fetch("/api/auth/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) });
      const body = (await res.json()) as { redirect?: string; signIn?: string };
      window.location.href = body.redirect ?? body.signIn ?? "/verify";
    } catch {
      setBusy(null);
    }
  }

  async function signOut() {
    setBusy("out");
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } finally {
      window.location.href = "/verify";
    }
  }

  if (me === undefined) return <span className="h-8 w-20 animate-pulse rounded-lg bg-surface2" aria-hidden />;

  if (!me) {
    return (
      <a href="/verify" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:text-[#0e0d13]">
        Sign in
      </a>
    );
  }

  const badge = idBadge(me.attestationId);
  const who = me.name ?? (me.role === "merchant" ? me.label : "Buyer");
  return (
    <div className="flex items-center gap-2">
      <a
        href={me.home}
        className="flex max-w-[220px] items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm transition-colors hover:border-accent"
        title={`Signed in with Self as ${me.role === "merchant" ? `merchant ${me.label}` : "a buyer"}`}
      >
        <span className="truncate">{who}</span>
        <span className="hidden shrink-0 text-xs text-muted sm:inline">{me.role === "merchant" ? "Merchant" : "Buyer"}</span>
        <span className={`hidden shrink-0 rounded-md px-1.5 py-px text-[10px] font-semibold sm:inline ${badge.cls}`}>{badge.label}</span>
      </a>
      {me.switchTo && (
        <button
          onClick={() => switchTo(me.switchTo!)}
          disabled={busy !== null}
          title={`You've also verified as a ${me.switchTo === "merchant" ? "merchant" : "buyer"} in this browser: no new scan needed`}
          className="hidden rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink disabled:opacity-60 sm:block"
        >
          {busy === "switch" ? "Switching…" : `Switch to ${me.switchTo === "merchant" ? "merchant" : "buyer"}`}
        </button>
      )}
      <button
        onClick={signOut}
        disabled={busy !== null}
        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-bad hover:text-bad disabled:opacity-60"
      >
        {busy === "out" ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
