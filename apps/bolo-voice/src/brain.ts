import WebSocket from "ws";
import { chat, parseBuyer, parseMerchant, resample8k, sarvamReady, speakPcm8k, sttUrl, wavHeader8k, type InvoiceDraft } from "./sarvam";

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

/*
 * Half-duplex, by design: while Bolo speaks she does not listen. Mic frames
 * that arrive during her playback (plus a short tail, so her own voice
 * echoing back from the speaker isn't heard) are replaced with silence
 * before Saaras sees them. No barge-in: it used to fire on that echo and cut
 * Bolo off mid-sentence.
 */
const ECHO_TAIL_MS = 400;

/*
 * "Listen to the loudest voice": a gate that follows the main speaker. It
 * tracks the recent peak level of the person at the mic and passes only
 * frames within ~10 dB of it; quieter voices in the room (and fan/street
 * noise) become silence. A short hangover keeps word endings intact.
 */
const NOISE_FLOOR = 0.012; // RMS below this is never speech
const GATE_RATIO = 0.35; // pass frames ≥ 35% of the speaker's recent peak (~-9 dB)
// The peak relaxes so a genuinely quieter speaker isn't locked out — but only
// while sound is actually arriving. Silence (Bolo thinking, Bolo talking, the
// caller pausing) says nothing about how loud the caller is, so it must not
// lower the bar; otherwise a quiet voice slips in right after a pause.
const PEAK_HALF_LIFE_MS = 6000; // of audible audio, not wall-clock time
const GATE_HANGOVER_MS = 350;
const GATE_PREROLL_MS = 250; // look-ahead, so a word's soft onset isn't clipped

/*
 * Smooth playback: 100 ms packets, kept ~300 ms ahead of real time so the
 * browser always has audio queued. 20 ms packets on a setTimeout loop were
 * jittery enough to starve the player, which is why Bolo stuttered.
 */
const PACKET_MS = 100;
const PACKET_BYTES = (8000 * 2 * PACKET_MS) / 1000; // 1600 bytes of PCM16 @ 8 kHz
const PREBUFFER_MS = 300;

type Wire = { send: (s: string) => void; close: (code?: number) => void };

export class BoloSession {
  /** The id the server issued for this session — the callback must report it, not a fresh one. */
  readonly id: string;
  private startedAt = Date.now();
  private stt: WebSocket | null = null;
  /** Lines queued or being sent; Bolo is "speaking" while any are pending… */
  private pendingSays = 0;
  /** …and until her last line has finished playing, plus the echo tail. */
  private speakingUntil = 0;
  private synthQueue: Promise<void> = Promise.resolve();
  /** Loudest-voice gate state. */
  private voicePeak = 0;
  /** Audio-time (ms of mic audio received) and the gate's look-ahead queue. */
  private audioMs = 0;
  private lastLoudEnd = -Infinity;
  private delayLine: { pcm: Buffer; start: number; end: number; loud: boolean; muted: boolean }[] = [];
  private utterance = "";
  private utterTimer: NodeJS.Timeout | null = null;
  private expect: "draft" | "confirm" | "pay_confirm" = "draft";
  private draft: InvoiceDraft | null = null;
  private busy = false;
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

  /** True while Bolo has lines queued, or her last line is still playing (+ echo tail). */
  private isSpeaking(): boolean {
    return this.pendingSays > 0 || Date.now() < this.speakingUntil;
  }

  /**
   * Mic audio from the browser (base64 PCM16 8 kHz). Every frame still goes
   * to Saaras — the stream must stay continuous — but as silence unless it
   * is the main speaker talking while Bolo is quiet.
   */
  onMedia(payload: string) {
    if (this.ended || !this.stt || this.stt.readyState !== WebSocket.OPEN) return;
    const pcm = Buffer.from(payload, "base64");
    const ms = (pcm.length / 2 / 8000) * 1000;
    // Muted frames (Bolo talking, or her echo tail) never pass, whatever their level.
    const muted = this.isSpeaking();
    const loud = !muted && this.isMainVoice(pcm, ms);
    const start = this.audioMs;
    this.audioMs += ms;
    this.delayLine.push({ pcm, start, end: this.audioMs, loud, muted });
    this.flushDelayLine();
  }

  /**
   * The gate decides each frame GATE_PREROLL_MS late, by audio time (not wall
   * clock, so bursty network arrival can't skew it). That look-ahead lets the
   * soft onset of a word — the "h" of "हाँ" — through when loud speech follows,
   * instead of clipping it; the hangover keeps word endings.
   */
  private flushDelayLine() {
    for (;;) {
      const next = this.delayLine[0];
      if (!next || next.end > this.audioMs - GATE_PREROLL_MS) break;
      const head = this.delayLine.shift()!;
      if (head.loud) this.lastLoudEnd = head.end;
      const loudAhead = this.delayLine.some((f) => f.loud && f.start - head.end < GATE_PREROLL_MS);
      const inHangover = head.start - this.lastLoudEnd < GATE_HANGOVER_MS;
      const pass = !head.muted && (head.loud || loudAhead || inHangover);
      const data = pass ? head.pcm.toString("base64") : Buffer.alloc(head.pcm.length).toString("base64");
      this.stt!.send(JSON.stringify({ audio: { data, encoding: "audio/wav", sample_rate: 8000 } }));
    }
  }

  /** Loudest-voice test: is this frame the person at the mic (not a quieter voice behind them)? */
  private isMainVoice(pcm: Buffer, ms: number): boolean {
    const n = pcm.length >> 1;
    if (!n) return false;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const s = pcm.readInt16LE(i * 2) / 0x8000;
      sum += s * s;
    }
    const level = Math.sqrt(sum / n);
    // Only audible frames move the peak: they raise it, and they slowly relax it.
    if (level > NOISE_FLOOR) {
      this.voicePeak *= Math.pow(0.5, ms / PEAK_HALF_LIFE_MS);
      this.voicePeak = Math.max(this.voicePeak, level);
    }
    return level > NOISE_FLOOR && level >= this.voicePeak * GATE_RATIO;
  }

  /** The browser echoes our mark when its playback really reaches it: the truest "done speaking". */
  onMark(name: string) {
    if (name === "bolo_done" && this.pendingSays === 0) this.speakingUntil = Date.now() + ECHO_TAIL_MS;
  }

  /** `clear` from the browser: its playback was flushed (hang-up), so she isn't speaking. */
  onClear() {
    this.speakingUntil = 0;
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
        // Half-duplex: nothing heard while Bolo is talking counts as a turn.
        if (this.isSpeaking()) return;
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
    if (!said || this.busy || this.ended || this.isSpeaking()) return;
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
    this.pendingSays++;
    // Anything half-heard before she starts talking is dropped, not answered later.
    this.utterance = "";
    if (this.utterTimer) clearTimeout(this.utterTimer);
    this.synthQueue = this.synthQueue.then(async () => {
      try {
        const { pcm, sampleRate } = await speakPcm8k(text);
        const wire = resample8k(pcm, sampleRate);
        const durationMs = (wire.length / 2 / 8000) * 1000;
        const t0 = Date.now();
        // Mute the mic for the whole line now, before the first packet plays.
        this.speakingUntil = Math.max(this.speakingUntil, t0 + durationMs + ECHO_TAIL_MS);
        // Packet i is due at t0 + i·100 ms; send each PREBUFFER_MS early, so the
        // browser's queue never runs dry. The schedule is absolute, so timer
        // jitter can't accumulate into gaps.
        for (let i = 0, at = 0; at < wire.length; i++, at += PACKET_BYTES) {
          const wait = t0 + i * PACKET_MS - PREBUFFER_MS - Date.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          this.wire.send(JSON.stringify({ event: "media", media: { payload: wire.subarray(at, at + PACKET_BYTES).toString("base64") } }));
        }
        this.wire.send(JSON.stringify({ event: "mark", mark: { name: "bolo_done" } }));
        after?.();
      } catch (err) {
        console.error(`[bolo] tts failed: ${(err as Error).message}`);
      } finally {
        this.pendingSays--;
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
