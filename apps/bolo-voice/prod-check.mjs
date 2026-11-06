/**
 * Production gate check for a deployed Bolo voice server (no secret needed):
 *   1. /health answers and Sarvam is configured
 *   2. an UNSIGNED session request is refused (401)
 *   3. the wss:// /media-stream socket opens, and a start with a bogus token
 *      is refused with close code 4001 (fail-closed, like Ritu)
 *
 *   node prod-check.mjs https://bolo-voice-production.up.railway.app
 */
import { WebSocket } from "ws";

const base = (process.argv[2] ?? "https://bolo-voice-production.up.railway.app").replace(/\/$/, "");
const ok = (b, msg) => console.log(`${b ? "✅" : "❌"} ${msg}`);
let pass = true;

const health = await fetch(`${base}/health`).then((r) => r.json()).catch(() => null);
ok(health?.ok && health?.sarvam, `health: ${JSON.stringify(health)}`);
pass &&= Boolean(health?.ok && health?.sarvam);

const unsigned = await fetch(`${base}/v1/browser-sessions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ script: { role: "merchant", actor: "x" } }),
});
ok(unsigned.status === 401, `unsigned session request → ${unsigned.status} (want 401)`);
pass &&= unsigned.status === 401;

const code = await new Promise((resolve) => {
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/media-stream`);
  ws.on("open", () => {
    ws.send(JSON.stringify({ event: "connected" }));
    ws.send(JSON.stringify({ event: "start", start: { streamSid: "chk", callSid: "chk", customParameters: { session_token: "bt_bogus" } } }));
  });
  ws.on("close", (c) => resolve(c));
  ws.on("error", () => resolve(-1));
  setTimeout(() => resolve(0), 10_000);
});
ok(code === 4001, `wss /media-stream with bogus token → close ${code} (want 4001)`);
pass &&= code === 4001;

process.exit(pass ? 0 : 1);
