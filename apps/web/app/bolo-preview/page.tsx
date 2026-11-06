"use client";

import { BoloAgent } from "../components/bolo-agent";

/*
 * Local preview of the floating Bolo robot (demo mode — no voice backend, no
 * auth). Tap it to cycle through the phases, drag the robot to spin it, drag
 * the grip to move it anywhere. For eyeballing the UI during development.
 */
export default function BoloPreviewPage() {
  return (
    <main className="min-h-screen bg-bg px-6 py-16 text-ink">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Bolo robot — preview</h1>
        <p className="text-muted">
          This page is just for looking at the robot. The real one lives on the buyer and merchant desks and talks over the voice server.
        </p>
        <ul className="space-y-2 rounded-2xl border border-line bg-surface p-5 text-sm text-muted">
          <li>👆 <span className="text-ink">Tap</span> the robot to cycle phases (idle → connecting → speaking → listening → thinking → working → done → error).</li>
          <li>🖐 <span className="text-ink">Drag the robot</span> to spin it (it keeps the spin, then eases back to a slow idle turn).</li>
          <li>⠿ <span className="text-ink">Drag the grip</span> above its head to move it anywhere on the page.</li>
          <li>💬 Tapping opens the panel — captions, invoice link, results.</li>
        </ul>
        <p className="text-xs text-muted">Watch the eyes blink, the arc of gestures (Wave / ThumbsUp / Dance / No), and the phase-coloured glow pulse with the (simulated) voice level.</p>
      </div>

      <BoloAgent role="buyer" demo />
    </main>
  );
}
