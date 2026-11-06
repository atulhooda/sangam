import WebSocket from "ws";
import { chat, parseBuyer, parseMerchant, resample8k, sarvamReady, speakPcm8k, sttUrl, wavHeader8k, CHUNK_BYTES, type InvoiceDraft } from "./sarvam";

/*
 * One live Bolo conversation. Mirrors Ritu's intake CallHandler: the wire
 * protocol is Ritu's /media-stream (connected → start → media/mark/stop up,
 * media/mark/clear/captions down), the brain is a per-role state machine over
 * streamed Saaras transcripts, and every turn is captioned back so the UI can
 * show what was heard.
 *
 *   merchant:  draft → speak back the parsed invoice → confirm → callback
 *   buyer:     amount/status read-out, or confirm-to-pay → callback
 *
 * Authority stays with the app: this server only converses and reports. The
 * web backend decides whether a confirmed invoice becomes a real one and
 * whether the buyer's agent actually pays — via the signed callback.
 */

export type Script = {
  role: "merchant" | "buyer";
  /** Merchant's ENS name, or the buyer's label. */
  actor: string;
  /** Buyer sessions: where to read the invoice status from. */
  statusUrl?: string;
  /** Buyer sessions: whom they're paying. */
  buyerName?: string;
};

export type CallbackResult = {
  status: "completed" | "failed" | "no_input" | "canceled";
  result?: {
    role: "merchant" | "buyer";
    invoice?: InvoiceDraft;
    intent?: "pay";
  };
};

const MAX_DURATION_MS = 5 * 60_000;
const UTTERANCE_SILENCE_MS = 1100; // Saaras keeps finalising chunks; 1.1 s of quiet ends a turn

type Wire = { send: (s: string) => void; close: (code?: number) => void };

export class BoloSession {
  /** The id the server issued for this session — the callback must report it, not a fresh one. */
  readonly id: string;
  private startedAt = Date.now();
  private stt: WebSocket | null = null;
  private speaking = false;
  private synthQueue: Promise<void> = Promise.resolve();
  private utterance = "";
  private utterTimer: NodeJS.Timeout | null = null;
  private expect: "draft" | "confirm" | "pay_confirm" = "draft";
  private draft: InvoiceDraft | null = null;
  private busy = false;
  private bargeFrames = 0;
  private ended = false;
  private maxTimer: NodeJS.Timeout;

  constructor(
    private wire: Wire,
    readonly issuedId: string,
    private script: Script,
    private callbackUrl: string | null,
    private onEnded: (result: CallbackResult) => void,
  ) {
    this.id = issuedId;
    this.maxTimer = setTimeout(() => void this.end({ status: "no_input" }, "समय हो गया।"), MAX_DURATION_MS);
  }

  /** The `start` event arrived and the token checked out: open the STT stream and greet. */
  begin() {
    if (!sarvamReady()) {
      this.caption("bolo", "Bolo ka Sarvam key set nahi hai.");
      void this.end({ status: "failed" });
      return;
    }
    this.openStt();
    const greeting =
      this.script.role === "merchant"
        ? "नमस्ते! मैं बोलो हूँ। किसके लिए, कितने रुपये का इनवॉइस बनाना है?"
        : `नमस्ते! बोलिए — कितना देना है, या भर दूँ?`;
    this.say(greeting);
  }

  /** Mic audio from the browser (base64 PCM16 8 kHz), plus our own barge-in check. */
  onMedia(payload: string) {
    if (this.ended) return;
    if (this.stt && this.stt.readyState === WebSocket.OPEN)
      this.stt.send(JSON.stringify({ audio: { data: payload, encoding: "audio/wav", sample_rate: 8000 } }));
    // Saaras sends no VAD events, so detect a barger by ear: a few loud frames
    // from the caller while we're mid-sentence flush our playback with a
    // `clear`, exactly as the phone network would.
    if (this.speaking) {
      const buf = Buffer.from(payload, "base64");
      let sum = 0;
      const n = Math.min(buf.length >> 1, 160);
      for (let i = 0; i < n; i++) {
        const s = buf.readInt16LE(i * 2) / 0x8000;
        sum += s * s;
      }
      this.bargeFrames = Math.sqrt(sum / Math.max(1, n)) > 0.03 ? this.bargeFrames + 1 : 0;
      if (this.bargeFrames >= 3) {
        this.bargeFrames = 0;
        this.speaking = false;
        this.busy = false;
        this.wire.send(JSON.stringify({ event: "clear" }));
      }
    }
  }

  /** The browser echoed a mark; nothing to do — playback tracking is client-side. */
  onMark(_name: string) {}

  /** `clear` from the browser means our audio was flushed (barge-in or hang-up). */
  onClear() {
    this.speaking = false;
  }

  stop() {
    void this.end({ status: "canceled" });
  }

  /* ── STT stream ── */

  private openStt() {
    const stt = new WebSocket(sttUrl(8000), { headers: { "api-subscription-key": process.env.SARVAM_API_KEY!.trim() } });
    this.stt = stt;
    stt.on("open", () => {
      // One WAV header up front; every later frame is raw PCM appended to it —
      // as far as Saaras is concerned it is decoding one long 8 kHz WAV.
      stt.send(JSON.stringify({ audio: { data: wavHeader8k(), encoding: "audio/wav", sample_rate: 8000 } }));
    });
    let sawData = false;
    stt.on("message", (raw: WebSocket.RawData) => {
      let msg: { type?: string; data?: { transcript?: string } };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "data" && typeof msg.data?.transcript === "string" && msg.data.transcript.trim()) {
        sawData = true;
        const text = msg.data.transcript.trim();
        this.caption(this.script.role, text);
        this.utterance = text; // Saaras finals supersede earlier chunks
        if (this.utterTimer) clearTimeout(this.utterTimer);
        this.utterTimer = setTimeout(() => void this.onUtterance(), UTTERANCE_SILENCE_MS);
      }
    });
    stt.on("close", (code: number, reason: Buffer) => {
      console.log(`[bolo] stt closed: code=${code} reason=${reason.toString().slice(0, 120)} sawData=${sawData}`);
      if (!this.ended && !sawData) this.end({ status: "failed" });
    });
    stt.on("error", (e: Error) => {
      console.error(`[bolo] stt error: ${e.message}`);
      stt.close();
    });
  }

  /** The caller stopped talking: answer. */
  private async onUtterance() {
    const said = this.utterance.trim();
    this.utterance = "";
    if (!said || this.busy || this.ended) return;
    this.busy = true;
    try {
      if (this.script.role === "merchant") await this.merchantTurn(said);
      else await this.buyerTurn(said);
    } catch (err) {
      this.caption("bolo", `माफ़ कीजिए — ${(err as Error).message.slice(0, 80)}`);
      this.say("माफ़ कीजिए, कुछ गड़बड़ हुई। फिर बोलिए।");
    } finally {
      this.busy = false;
    }
  }

  /* ── merchant brain ── */

  private async merchantTurn(said: string) {
    if (this.expect === "confirm" && this.draft) {
      const { yes, no } = await parseMerchant(said, "confirm");
      if (yes && this.draft.buyerName && this.draft.amountInr) {
        const d = this.draft;
        this.draft = null;
        this.expect = "draft";
        // end() posts the signed callback and speaks its reply (or this fallback).
        await this.end({ status: "completed", result: { role: "merchant", invoice: d } }, "ठीक है, इनवॉइस बन गया। धन्यवाद!");
        return;
      }
      if (no) {
        this.draft = null;
        this.expect = "draft";
        this.say("ठीक है, फिर से बोलिए — किसके लिए, कितने रुपये का इनवॉइस है?");
        return;
      }
      this.say("हाँ या ना में बताइए — इनवॉइस बनाऊँ?");
      return;
    }
    const { draft } = await parseMerchant(said, "draft");
    if (!draft) return;
    if (draft.buyerName && draft.amountInr) {
      this.draft = draft;
      this.expect = "confirm";
      this.say(
        `${draft.buyerName} के लिए ${draft.amountInr} रुपये का इनवॉइस${draft.dueDays ? `, ${draft.dueDays} दिन की सीमा` : ""} — बना दूँ? हाँ या ना बोलिए।`,
      );
    } else if (draft.buyerName || draft.amountInr) {
      this.say(draft.buyerName ? "रकम नहीं सुनी — कितने रुपये का इनवॉइस है?" : "किसके लिए इनवॉइस है?");
    }
  }

  /* ── buyer brain ── */

  private async buyerTurn(said: string) {
    if (this.expect === "pay_confirm") {
      const intent = await parseBuyer(said);
      if (intent === "yes") {
        this.expect = "draft";
        await this.end({ status: "completed", result: { role: "buyer", intent: "pay" } }, "ठीक है, भर रही हूँ।");
        return;
      }
      if (intent === "no") {
        this.expect = "draft";
        this.say("ठीक है, नहीं भरती। कुछ और बताइए?");
        return;
      }
      this.say("हाँ या ना में बताइए — भर दूँ?");
      return;
    }
    const intent = await parseBuyer(said);
    if (intent === "pay") {
      this.expect = "pay_confirm";
      this.say(`भर दूँ? ठीक है? हाँ या ना बोलिए।`);
      return;
    }
    if (intent === "amount" || intent === "status") {
      const s = this.script.statusUrl ? await this.readStatus() : null;
      if (!s) this.say("इनवॉइस नहीं मिला — लिंक दोबारा चेक कीजिए।");
      else if (s.status === "paid") this.say("यह इनवॉइस भरा जा चुका है। धन्यवाद!");
      else this.say(`${s.buyer} को ${Math.round(s.amountPaise / 100)} रुपये देने हैं। भर दूँ? हाँ या ना बोलिए।`, s.status !== "paid" ? () => (this.expect = "pay_confirm") : undefined);
      return;
    }
    this.say("समझ नहीं आया। कितना देना है, या भर दूँ?");
  }

  private async readStatus(): Promise<{ status: string; buyer: string; amountPaise: number } | null> {
    if (!this.script.statusUrl) return null;
    try {
      const res = await fetch(this.script.statusUrl, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return null;
      return (await res.json()) as { status: string; buyer: string; amountPaise: number };
    } catch {
      return null;
    }
  }

  /* ── speaking: Bulbul → PCM16 8 kHz → media events + captions ── */

  private say(text: string, after?: () => void) {
    this.caption("bolo", text);
    this.speaking = true;
    this.synthQueue = this.synthQueue.then(async () => {
      try {
        const { pcm, sampleRate } = await speakPcm8k(text);
        const wire = resample8k(pcm, sampleRate);
        for (let at = 0; at < wire.length; at += CHUNK_BYTES) {
          if (!this.speaking) break; // barged in — drop the rest
          const chunk = wire.subarray(at, at + CHUNK_BYTES);
          this.wire.send(JSON.stringify({ event: "media", media: { payload: chunk.toString("base64") } }));
          await new Promise((r) => setTimeout(r, 18)); // ~20 ms chunks, a hair under real time
        }
        if (this.speaking) this.wire.send(JSON.stringify({ event: "mark", mark: { name: "bolo_done" } }));
        this.speaking = false;
        after?.();
      } catch (err) {
        console.error(`[bolo] tts failed: ${(err as Error).message}`);
        this.speaking = false;
      }
    });
  }

  private caption(role: "bolo" | "merchant" | "buyer", text: string) {
    this.wire.send(JSON.stringify({ event: "bolo_caption", role, text }));
  }

  /* ── ending: signed callback, then close ── */

  private async end(result: CallbackResult, fallbackReply?: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.maxTimer);
    if (this.utterTimer) clearTimeout(this.utterTimer);
    this.stt?.close();
    let reply = fallbackReply;
    if (this.callbackUrl && result.status !== "failed") {
      reply = (await this.callback(result)) ?? reply;
    }
    if (reply) this.say(reply);
    // Let the closing line play before the socket drops.
    setTimeout(() => this.wire.close(1000), 4_000);
    this.onEnded(result);
  }

  private async callback(result: CallbackResult): Promise<string | null> {
    if (!this.callbackUrl) return null;
    const body = JSON.stringify({
      session_id: this.id,
      status: result.status,
      started_at: new Date(this.startedAt).toISOString(),
      ended_at: new Date().toISOString(),
      result: result.result,
    });
    const { sign } = await import("./hmac");
    const ts = String(Math.floor(Date.now() / 1000));
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(this.callbackUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "X-Bolo-Timestamp": ts, "X-Bolo-Signature": sign(ts, body) },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as { reply?: string };
          return data.reply ?? null;
        }
      } catch (err) {
        console.error(`[bolo] callback attempt ${attempt} failed: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, attempt * 2_000));
    }
    return null;
  }
}
