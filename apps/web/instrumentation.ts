/*
 * Runs once when the server starts. Starts the deposit-account watcher: every
 * 20 s this server asks itself (POST /api/internal/watch-deposits) to turn any
 * USDC that landed in a merchant's deposit account into a settlement. Going
 * through the route keeps the watcher in the normal server runtime.
 *
 * WATCH_DEPOSITS=false turns it off.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.WATCH_DEPOSITS?.trim() === "false") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const g = globalThis as unknown as { __sangamWatcher?: ReturnType<typeof setInterval> };
  if (g.__sangamWatcher) return;

  const port = process.env.PORT ?? "5173";
  const tick = async () => {
    const secret = process.env.SETTLEMENT_SHARED_SECRET;
    if (!secret) return;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/internal/watch-deposits`, {
        method: "POST",
        headers: { "x-sangam-key": secret },
        signal: AbortSignal.timeout(55_000),
      });
      if (!res.ok) return;
      const r = (await res.json()) as { claimed: { merchant: string; hederaTxId: string }[]; errors: string[] };
      for (const c of r.claimed) console.log(`[watcher] ${c.merchant}: USDC transfer ${c.hederaTxId} → settlement`);
      for (const e of r.errors) console.warn(`[watcher] ${e}`);
    } catch {
      /* server still starting, or a slow tick: try again next time */
    }
  };
  g.__sangamWatcher = setInterval(tick, 20_000);
}
