import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { BoloSession, type Script } from "./brain";
import { sarvamReady, speakPcm8k } from "./sarvam";
import { verify } from "./hmac";

/*
 * The Bolo voice server — Sangam's Ritu.
 *
 *   POST /v1/browser-sessions   HMAC-authed session issue: the web backend
 *                               creates a session and gets {session_id,
 *                               ws_url, token}; the token is single-use and
 *                               lives 2 minutes.
 *   WS   /media-stream          Ritu's exact protocol. Audio never passes
 *                               through the web app: browser ⇄ here directly.
 *   POST /v1/speech             HMAC-authed one-shot text → WAV (Bulbul).
 *   GET  /health
 */

type SessionRecord = { id: string; script: Script; callbackUrl: string | null; token: string; expiresAt: number; used: boolean };
const sessions = new Map<string, SessionRecord>();

const TOKEN_TTL_MS = 2 * 60_000;

const json = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1 << 20) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, sarvam: sarvamReady(), sessions: sessions.size });
  }

  if (req.method === "POST" && url.pathname === "/v1/browser-sessions") {
    const body = await readBody(req);
    if (!verify(req.headers["x-bolo-timestamp"] as string | undefined, req.headers["x-bolo-signature"] as string | undefined, body))
      return json(res, 401, { error: "bad signature" });
    let parsed: { script?: Script; callback_url?: string };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      return json(res, 400, { error: "bad json" });
    }
    const script = parsed.script;
    if (!script || (script.role !== "merchant" && script.role !== "buyer")) return json(res, 400, { error: "script.role must be merchant|buyer" });
    const token = `bt_${randomUUID().replace(/-/g, "")}`;
    const record: SessionRecord = {
      id: `bs_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      script,
      callbackUrl: parsed.callback_url ?? null,
      token,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      used: false,
    };
    sessions.set(token, record);
    const base = (process.env.BOLO_PUBLIC_WS_BASE ?? `ws://localhost:${process.env.PORT ?? 3200}`).replace(/\/$/, "");
    return json(res, 201, {
      session_id: record.id,
      ws_url: `${base}/media-stream`,
      token,
      expires_at: new Date(record.expiresAt).toISOString(),
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/speech") {
    const body = await readBody(req);
    if (!verify(req.headers["x-bolo-timestamp"] as string | undefined, req.headers["x-bolo-signature"] as string | undefined, body))
      return json(res, 401, { error: "bad signature" });
    try {
      const { text } = JSON.parse(body) as { text?: string };
      if (!text?.trim()) return json(res, 400, { error: "text required" });
      const wav = await speakWav(text);
      res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length });
      res.end(wav);
    } catch (err) {
      json(res, 502, { error: (err as Error).message.slice(0, 200) });
    }
    return;
  }

  json(res, 404, { error: "not found" });
});

import { resample8k } from "./sarvam";

async function speakWav(text: string): Promise<Buffer> {
  const { pcm, sampleRate } = await speakPcm8k(text);
  const wire = resample8k(pcm, sampleRate);
  // Wrap the PCM in a minimal 8 kHz WAV header (44 bytes).
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + wire.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(wire.length, 40);
  return Buffer.concat([header, wire]);
}

/* ── the media-stream socket ── */

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/media-stream") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws: WebSocket) => {
  let session: BoloSession | null = null;
  let record: SessionRecord | null = null;

  const wire = {
    send: (s: string) => ws.readyState === WebSocket.OPEN && ws.send(s),
    close: (code?: number) => ws.close(code ?? 1000),
  };

  ws.on("message", (raw: RawData) => {
    let msg: {
      event?: string;
      start?: { customParameters?: { session_token?: string; callSource?: string } };
      media?: { payload?: string };
      mark?: { name?: string };
    };
    try {
      msg = JSON.parse(raw.toString()) as typeof msg;
    } catch {
      return;
    }

    if (msg.event === "start") {
      // Fail-closed, as Ritu does: no valid, unexpired, unused token, no session.
      const token = msg.start?.customParameters?.session_token ?? "";
      const hit = sessions.get(token);
      if (!hit || hit.used || hit.expiresAt < Date.now()) {
        ws.send(JSON.stringify({ event: "clear" }));
        ws.close(4001, "invalid session token");
        return;
      }
      hit.used = true;
      record = hit;
      session = new BoloSession(wire, hit.id, hit.script, hit.callbackUrl, () => sessions.delete(token));
      session.begin();
      return;
    }
    if (!session || !record) return; // everything else needs the gated start
    if (msg.event === "media") {
      if (msg.media?.payload) session.onMedia(msg.media.payload);
    } else if (msg.event === "mark") {
      if (msg.mark?.name) session.onMark(msg.mark.name);
    } else if (msg.event === "clear") {
      session.onClear();
    } else if (msg.event === "stop") {
      session.stop();
    }
  });

  ws.on("close", () => session?.stop());
});

const port = Number(process.env.PORT ?? 3200);
server.listen(port, () => console.log(`[bolo-voice] listening on :${port} — Sarvam ${sarvamReady() ? "ready" : "MISSING KEY"}`));
