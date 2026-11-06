/**
 * Bolo voice server smoke test — the full browser protocol without a browser:
 *   HMAC session issue → /media-stream socket → streamed mic audio (here:
 *   Bulbul renders the caller's lines to PCM and we stream them as media
 *   events, exactly as the browser would) → captions + spoken replies come
 *   back → signed callback reports the confirmed invoice.
 *
 *   node smoke.mjs            # voice server on :3200, callback mock on :3299
 */
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket } from "ws";

const SECRET = process.env.BOLO_SHARED_SECRET ?? "smoke-secret";
const VOICE = process.env.BOLO_VOICE_URL ?? "http://localhost:3200";
const SARVAM_KEY = process.env.SARVAM_API_KEY ?? "";

const sign = (ts, body) => createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
const say = async (text) => {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": SARVAM_KEY, "content-type": "application/json" },
    body: JSON.stringify({ text, language_code: "hi-IN", target_language_code: "hi-IN", model: "bulbul:v4-flash", speaker: "simran_en_customer" }),
  }).then((r) => r.json());
  return Buffer.from(res.audios[0], "base64");
};
const decodeWav = (buf) => {
  let at = 12, rate = 24000, channels = 1, data = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") { channels = buf.readUInt16LE(at + 10); rate = buf.readUInt32LE(at + 12); }
    if (id === "data") data = buf.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  let pcm = data;
  if (channels === 2) {
    const mono = Buffer.alloc(data.length / 2);
    for (let i = 0; i < mono.length / 2; i++) mono.writeInt16LE(Math.round((data.readInt16LE(i * 4) + data.readInt16LE(i * 4 + 2)) / 2), i * 2);
    pcm = mono;
  }
  if (rate !== 8000) {
    const frames = Math.floor(pcm.length / 2);
    const outFrames = Math.floor(frames / (rate / 8000));
    const out = Buffer.alloc(outFrames * 2);
    for (let i = 0; i < outFrames; i++) {
      const j = Math.min(Math.floor(i * (rate / 8000)), frames - 1);
      out.writeInt16LE(pcm.readInt16LE(j * 2), i * 2);
    }
    pcm = out;
  }
  return pcm;
};

// A mock of the web app's callback receiver: log what Bolo reports.
const received = [];
const cbServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const ts = req.headers["x-bolo-timestamp"], sig = req.headers["x-bolo-signature"];
    const ok = ts && sig && createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex") === sig;
    received.push({ ok, body: JSON.parse(body) });
    console.log(`📞 CALLBACK (signature ${ok ? "VALID" : "INVALID"}):`, body.slice(0, 220));
    res.end(JSON.stringify({ reply: "इनवॉइस बन गया। पे लिंक तैयार है।" }));
  });
});
await new Promise((r) => cbServer.listen(3299, r));

// Scale a PCM16 line's volume (a quieter voice further from the mic).
const quiet = (pcm, gain) => {
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length / 2; i++) out.writeInt16LE(Math.round(pcm.readInt16LE(i * 2) * gain), i * 2);
  return out;
};
// Every caller phrase is rendered up front, so the test can speak at exact moments.
const invoiceLine = decodeWav(await say("रमेश के लिए 2500 का इनवॉइस, सात दिन"));
const yesLine = decodeWav(await say("हाँ, बना दो"));
const decoyLine = decodeWav(await say("सुरेश के लिए 9000 का इनवॉइस"));
const backgroundNo = quiet(decodeWav(await say("नहीं, मत बनाओ")), 0.2);

// 1. HMAC-authed session issue — what the web app's /api/bolo/session does.
const body = JSON.stringify({
  external_ref: "sangam:merchant:smoke",
  script: { role: "merchant", actor: "smoke.merchant" },
  callback_url: "http://localhost:3299/cb",
  max_duration_s: 120,
});
const ts = String(Math.floor(Date.now() / 1000));
const created = await fetch(`${VOICE}/v1/browser-sessions`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-Bolo-Timestamp": ts, "X-Bolo-Signature": sign(ts, body) },
  body,
}).then((r) => r.json());
console.log("🔑 SESSION:", created.session_id, created.ws_url);

// 2. The socket: connected → start{token} → media → …
const ws = new WebSocket(created.ws_url);
const chunks = (pcm) => {
  const out = [];
  for (let at = 0; at < pcm.length; at += 320) out.push(pcm.subarray(at, at + 320));
  return out;
};
// A real mic never stops sending: between utterances it streams silence, and
// that trailing silence is what makes Saaras finalise a transcript. Mimic it.
let talking = false;
const SILENCE = Buffer.alloc(320).toString("base64");
const pump = setInterval(() => {
  if (!talking && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: "media", media: { payload: SILENCE } }));
}, 20);
const stream = async (pcm) => {
  talking = true;
  for (const c of chunks(pcm)) {
    if (ws.readyState !== WebSocket.OPEN) break;
    ws.send(JSON.stringify({ event: "media", media: { payload: c.toString("base64") } }));
    await new Promise((r) => setTimeout(r, 18)); // ~real time, as a live mic would
  }
  talking = false;
};

await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ event: "connected" }));
ws.send(JSON.stringify({ event: "start", start: { streamSid: "smoke", callSid: "smoke", customParameters: { session_token: created.token, callSource: "smoke" } } }));

// Track Bolo's real audio: a line starts with its first media packet and
// ends with its bolo_done mark. A simulated player (150 ms jitter buffer, like
// the browser's) counts underruns — every one is an audible stutter.
let marks = 0;
let inLine = false;
let lineStart = 0;
let queuedMs = 0;
let lineEndAt = 0;
let underruns = 0;
let lines = 0;
let lastBolo = "";
const callerCaptions = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.event === "media") {
    const now = Date.now();
    if (!inLine) {
      inLine = true;
      lines++;
      lineStart = now;
      queuedMs = 0;
    }
    if (now > lineStart + 150 + queuedMs) underruns++; // the player ran dry before this packet arrived
    queuedMs += (Buffer.from(m.media.payload, "base64").length / 2 / 8000) * 1000;
  }
  if (m.event === "mark" && m.mark?.name === "bolo_done") {
    marks++;
    inLine = false;
    lineEndAt = lineStart + 150 + queuedMs; // when the last sample actually finishes playing
  }
  if (m.event === "bolo_caption") {
    console.log(`  ${m.role === "bolo" ? "🎙 BOLO " : "🗣 CALLER"}: ${m.text}`);
    if (m.role === "bolo") lastBolo = m.text;
    else callerCaptions.push(m.text);
  }
});

/** Wait for Bolo to say `needle`, then for her audio to really finish playing, then a human pause. */
const waitForLine = async (needle, ms = 60_000) => {
  const t0 = Date.now();
  while (!lastBolo.includes(needle) && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 100));
  const seen = marks;
  while (marks === seen && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 100));
  while (Date.now() < lineEndAt + 900) await new Promise((r) => setTimeout(r, 50));
  return lastBolo.includes(needle);
};

// 3. The conversation, with two traps for the new behaviour.
// Trap 1 — half-duplex: talk OVER Bolo's greeting, while her audio is really playing.
while (!inLine) await new Promise((r) => setTimeout(r, 20));
await new Promise((r) => setTimeout(r, 400));
console.log("🗣 (decoy, spoken over Bolo's greeting: सुरेश 9000)");
await stream(decoyLine);
await waitForLine("नमस्ते");

console.log("🗣 (caller speaks the invoice line)");
await stream(invoiceLine);
const drafted = await waitForLine("बना दूँ");
console.log(drafted ? "   ↳ Bolo read the draft back" : "   ↳ (no draft read-back within 60 s)");

// Trap 2 — loudest voice: a quiet "no" from someone in the background, then the merchant's loud "haan".
console.log("🗣 (background voice at 20% volume: नहीं, मत बनाओ)");
await stream(backgroundNo);
await new Promise((r) => setTimeout(r, 300));
console.log("🗣 (caller confirms)");
await stream(yesLine);
await waitForLine("इनवॉइस बन गया");
clearInterval(pump);

const heardDecoy = callerCaptions.some((t) => t.includes("सुरेश") || t.includes("9000"));
const heardBackground = callerCaptions.some((t) => t.includes("मत"));
console.log(`${heardDecoy ? "❌" : "✅"} half-duplex: decoy spoken over Bolo was ${heardDecoy ? "HEARD" : "ignored"}`);
console.log(`${heardBackground ? "❌" : "✅"} loudest voice: quiet background "no" was ${heardBackground ? "HEARD" : "gated out"}`);
console.log(`${underruns === 0 ? "✅" : "❌"} smooth playback: ${underruns} underrun(s) across ${lines} spoken line(s)`);

// 4. Token single-use check: a replay of `start` must be refused.
const replay = new WebSocket(created.ws_url);
await new Promise((r) => replay.on("open", r));
replay.send(JSON.stringify({ event: "connected" }));
replay.send(JSON.stringify({ event: "start", start: { streamSid: "replay", callSid: "replay", customParameters: { session_token: created.token } } }));
const refused = await new Promise((resolve) => replay.on("close", (code) => resolve(code)));
console.log(`🔒 token replay close code: ${refused} (4001 = correctly refused)`);

ws.send(JSON.stringify({ event: "stop" }));
await new Promise((r) => setTimeout(r, 1500));
const inv = received[0]?.body.result?.invoice;
const rightInvoice = inv?.amountInr === 2500 && /रमेश|ramesh/i.test(inv?.buyerName ?? "");
console.log(rightInvoice ? `✅ INVOICE CALLBACK: ${JSON.stringify(inv)}` : `❌ wrong/no invoice in callback: ${JSON.stringify(inv ?? null)}`);
process.exit(rightInvoice && !heardDecoy && !heardBackground && underruns === 0 ? 0 : 1);
