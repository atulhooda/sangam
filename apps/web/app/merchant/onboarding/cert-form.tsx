"use client";

import { useState } from "react";
import type { Me } from "@/lib/types";
import { Card, CardHead, idBadge } from "../../components/ui";
import { Logo } from "../../components/space/kit";
import { AccountMenu } from "../../components/account-menu";

const MAX_MB = 5;

export function CertForm({ me, replacing }: { me: Me; replacing: boolean }) {
  const [companyName, setCompanyName] = useState(me.cert?.companyName ?? "");
  const [registrationNumber, setRegistrationNumber] = useState(me.cert?.registrationNumber ?? "");
  const [upiHandle, setUpiHandle] = useState(me.shop?.upiHandle ?? "");
  const [priceInr, setPriceInr] = useState(me.shop ? String(me.shop.priceInrPaise / 100) : "");
  const [endpoint, setEndpoint] = useState(me.shop?.endpoint ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badge = idBadge(me.attestationId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file && !me.cert) return setError("Attach the certificate file.");
    if (file && file.size > MAX_MB * 1024 * 1024) return setError(`The certificate must be ${MAX_MB} MB or smaller.`);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("companyName", companyName);
      form.set("registrationNumber", registrationNumber);
      form.set("upiHandle", upiHandle);
      form.set("priceInr", priceInr);
      form.set("endpoint", endpoint);
      if (file) form.set("file", file);
      const res = await fetch("/api/merchant/cert", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { error?: string; redirect?: string };
      if (!res.ok || !body.redirect) {
        setError(body.error ?? `Upload failed (${res.status})`);
        return;
      }
      window.location.href = body.redirect;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-full border border-white/10 bg-white/[0.05]2 px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div className="min-h-screen">
      <header className="space-bar sticky top-3 z-40">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <a href="/" aria-label="Sangam home"><Logo /></a>
            <span className="text-line">/</span>
            <span className="text-sm font-medium">Merchant onboarding</span>
          </div>
          <div className="flex items-center gap-3">
            <AccountMenu me={me} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-5 px-5 py-8 sm:py-12">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{replacing ? "Replace certificate" : "Step 2 of 2"}</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{replacing ? "Update your business details" : "Set up your shop"}</h1>
          <p className="mt-2 text-sm text-muted">
            Your identity is verified{" "}
            <span className={`rounded-md px-1.5 py-px text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>. Now show the business behind{" "}
            <span className="mono text-ink">{me.label}</span>: a certificate of incorporation, GST registration or shop licence.
          </p>
          <p className="mt-2 text-sm text-muted">
            Then Sangam gives you your own Hedera account and publishes <span className="mono text-ink">{me.label}</span> on ENS, marked verified, so
            agents can find you, check you, and pay you. USDC that lands there becomes rupees on your UPI.
          </p>
        </div>

        <Card>
          <CardHead title="Business details" hint="Kept on Sangam's server; only you can open the file." />
          <form onSubmit={submit} className="space-y-4 px-5 py-5">
            <label className="block">
              <span className="text-xs text-muted">Registered company name</span>
              <input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={input} placeholder="Annapurna Rail Tickets Pvt Ltd" maxLength={160} />
            </label>
            <label className="block">
              <span className="text-xs text-muted">GSTIN, CIN or registration number</span>
              <input
                required
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())}
                className={`${input} mono`}
                placeholder="27AAPFU0939F1ZV"
                maxLength={40}
              />
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-muted">UPI handle for payouts</span>
                <input required value={upiHandle} onChange={(e) => setUpiHandle(e.target.value.trim())} className={`${input} mono`} placeholder="myshop@okaxis" maxLength={97} />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Price per order (₹)</span>
                <input required type="number" min={1} max={100000} step="0.01" value={priceInr} onChange={(e) => setPriceInr(e.target.value)} className={input} placeholder="49" />
              </label>
            </div>
            <label className="block">
              <span className="text-xs text-muted">Your own x402 endpoint (optional)</span>
              <input value={endpoint} onChange={(e) => setEndpoint(e.target.value.trim())} className={`${input} mono`} placeholder="https://api.myshop.in/buy — blank uses Sangam's pay link" />
            </label>
            <label className="block">
              <span className="text-xs text-muted">
                Certificate (PDF, PNG or JPEG, up to {MAX_MB} MB){me.cert ? ` — on file: ${me.cert.fileName}; attach a new one to replace it` : ""}
              </span>
              <input
                required={!me.cert}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface2 file:px-3 file:py-2 file:text-sm file:text-ink hover:file:bg-line"
              />
            </label>
            {error && <p className="rounded-lg bg-badbg p-3 text-sm text-bad" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-accent px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-[#0b0d1a]"
            >
              {busy ? "Creating your Hedera account and ENS name…" : replacing ? "Save and update ENS →" : "Upload and set up my shop →"}
            </button>
            {busy && <p className="text-center text-xs text-muted">This sends a Hedera transaction and one or two Sepolia transactions. Up to a minute.</p>}
          </form>
        </Card>
        {replacing && (
          <p className="text-center text-sm">
            <a className="text-muted underline-offset-2 hover:text-ink hover:underline" href={me.home}>← Back to my desk</a>
          </p>
        )}
      </main>
    </div>
  );
}
