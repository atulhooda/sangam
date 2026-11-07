"use client";

/**
 * Audio transport between the browser and the Bolo voice server — a direct
 * port of OncoReady's ritu-voice.ts. Bolo does all the speech work
 * (recognition, conversation, synthesis); this only moves audio. Protocol:
 * Bolo's /media-stream, which is Ritu's:
 *   up:   connected, start{customParameters.session_token, mic_rate, play_rate}, media{payload: base64 PCM16}, mark, stop
 *   down: media{payload, sample_rate}, mark (echo when played), clear (flush playback),
 *         bolo_caption {role, text} (live captions)
 *
 * Audio is wideband: the mic goes up at 16 kHz (what Saaras recognises best)
 * and Bolo's voice comes down at 24 kHz. The old protocol was phone-band
 * 8 kHz both ways; a server that doesn't know these rates still sends 8 kHz,
 * which is what a media message without sample_rate means.
 */

const MIC_RATE = 16000;
const PLAY_RATE = 24000;
/** Mic stays muted this long after Bolo's audio ends, so her echo from the speaker isn't sent. */
const MIC_TAIL_S = 0.35;
/** Playback lead when the queue is empty: absorbs network jitter without audible delay. */
const JITTER_S = 0.15;

/** connecting → bolo (speaking) → listening → thinking (heard you, preparing a reply) → bolo … → ended */
export type VoicePhase = "connecting" | "bolo" | "listening" | "thinking" | "ended" | "error";

export type Caption = { role: "bolo" | "merchant" | "buyer"; text: string };

/** Bolo decided something the page acts on: "pick" (a shop was named, price read back) or "buy" (the buyer said yes). */
export type VoiceAction = { action: "pick" | "buy"; ensName: string };

export interface VoiceEvents {
  onPhase: (phase: VoicePhase, detail?: string) => void;
  onCaption?: (caption: Caption) => void;
  onAction?: (action: VoiceAction) => void;
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function toBase64Pcm16(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64Pcm16(payload: string): Float32Array<ArrayBuffer> {
  const binary = atob(payload);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) view.setUint8(i, binary.charCodeAt(i));
  const out = new Float32Array(binary.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

function rms(analyser: AnalyserNode | null, buf: Float32Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.min(1, Math.sqrt(sum / buf.length) * 4); // speech RMS ~0.05-0.25 → 0.2-1
}

export class BoloVoice {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private levelBuf = new Float32Array(512);
  private playing: AudioBufferSourceNode[] = [];
  private playEnd = 0;
  private phase: VoicePhase = "connecting";
  private stopped = false;

  constructor(
    private wsUrl: string,
    private token: string,
    private events: VoiceEvents,
  ) {}

  private setPhase(p: VoicePhase, detail?: string) {
    if (this.phase === p && !detail) return;
    if (this.phase === "ended" && p !== "error") return;
    this.phase = p;
    this.events.onPhase(p, detail);
  }

  /** Live loudness 0..1 of Bolo's playback and of the microphone (for the animation). */
  levels(): { bolo: number; mic: number } {
    return { bolo: rms(this.outAnalyser, this.levelBuf), mic: rms(this.micAnalyser, this.levelBuf) };
  }

  async start(): Promise<void> {
    this.setPhase("connecting");
    const mic = await navigator.mediaDevices.getUserMedia({
      // No automatic gain: in a crowded room it amplifies the crowd between
      // the caller's words. Noise suppression and echo cancellation stay on.
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    // stop() can land while the permission prompt is open. A stopped instance
    // must not go on to open the socket: it would spend the single-use token.
    if (this.stopped) {
      mic.getTracks().forEach((t) => t.stop());
      return;
    }
    this.mic = mic;
    this.ctx = new AudioContext();
    this.outAnalyser = this.ctx.createAnalyser();
    this.outAnalyser.fftSize = 512;
    // Wideband speech needs no EQ (the old shelf filters only tamed shrill
    // phone-band audio); a touch of warmth for small laptop speakers.
    const warmth = this.ctx.createBiquadFilter();
    warmth.type = "lowshelf";
    warmth.frequency.value = 250;
    warmth.gain.value = 2;
    const level = this.ctx.createGain();
    level.gain.value = 0.9;
    this.outAnalyser.connect(warmth).connect(level).connect(this.ctx.destination);
    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 512;

    const source = this.ctx.createMediaStreamSource(this.mic);
    source.connect(this.micAnalyser);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    source.connect(this.processor);
    this.processor.connect(this.ctx.destination); // required for onaudioprocess to fire; outputs silence
    this.processor.onaudioprocess = (e) => {
      if (this.ws?.readyState !== WebSocket.OPEN || !this.ctx) return;
      const samples = downsample(e.inputBuffer.getChannelData(0), this.ctx.sampleRate, MIC_RATE);
      // Half-duplex: while Bolo is talking (and briefly after, for speaker
      // echo) the mic sends silence. The stream stays continuous, which the
      // server's speech recogniser needs, but Bolo never hears herself.
      const botTalking = this.playing.length > 0 || this.ctx.currentTime < this.playEnd + MIC_TAIL_S;
      const payload = toBase64Pcm16(botTalking ? new Float32Array(samples.length) : samples);
      this.ws.send(JSON.stringify({ event: "media", media: { payload } }));
    };

    const id = Math.random().toString(36).slice(2, 11);
    this.ws = new WebSocket(this.wsUrl);
    this.ws.onopen = () => {
      this.ws!.send(JSON.stringify({ event: "connected" }));
      this.ws!.send(
        JSON.stringify({
          event: "start",
          start: {
            streamSid: `sg_${id}`,
            callSid: `sg_${id}`,
            customParameters: { session_token: this.token, callSource: "sangam_browser", mic_rate: MIC_RATE, play_rate: PLAY_RATE },
          },
        }),
      );
    };
    this.ws.onmessage = (ev) => this.handle(ev.data);
    this.ws.onerror = () => this.setPhase("error", "Connection to Bolo failed");
    this.ws.onclose = () => {
      this.cleanup();
      this.setPhase("ended");
    };
  }

  private handle(raw: string) {
    let msg: { event?: string; media?: { payload?: string; sample_rate?: number }; mark?: { name?: string }; role?: string; text?: string; action?: string; ensName?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.event === "media" && msg.media?.payload && this.ctx && this.outAnalyser) {
      const samples = fromBase64Pcm16(msg.media.payload);
      const buffer = this.ctx.createBuffer(1, samples.length, msg.media.sample_rate ?? 8000);
      buffer.copyToChannel(samples, 0);
      const node = this.ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.outAnalyser);
      // Jitter buffer: when the queue has run dry (a new line, or a late
      // packet), start a little in the future so the next packets can line
      // up behind this one instead of each one playing late and choppy.
      const now = this.ctx.currentTime;
      const at = this.playEnd > now ? this.playEnd : now + JITTER_S;
      node.start(at);
      this.playEnd = at + buffer.duration;
      this.playing.push(node);
      node.onended = () => {
        this.playing = this.playing.filter((n) => n !== node);
        if (!this.playing.length && this.phase === "bolo") this.setPhase("listening");
      };
      this.setPhase("bolo");
    } else if (msg.event === "mark" && msg.mark?.name) {
      // Echo once our playback reaches this point, as the phone network would.
      const wait = this.ctx ? Math.max(0, (this.playEnd - this.ctx.currentTime) * 1000) : 0;
      const name = msg.mark.name;
      setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ event: "mark", mark: { name } }));
        if (name === "bolo_done" && !this.playing.length) this.setPhase("listening");
      }, wait);
    } else if (msg.event === "clear") {
      this.playing.forEach((n) => n.stop());
      this.playing = [];
      this.playEnd = this.ctx?.currentTime ?? 0;
      this.setPhase("listening");
    } else if (msg.event === "bolo_action" && (msg.action === "pick" || msg.action === "buy") && msg.ensName) {
      this.events.onAction?.({ action: msg.action, ensName: msg.ensName });
    } else if (msg.event === "bolo_caption" && msg.text) {
      const role = msg.role === "bolo" || msg.role === "merchant" || msg.role === "buyer" ? msg.role : "bolo";
      this.events.onCaption?.({ role, text: msg.text });
      if (role !== "bolo" && this.phase !== "bolo") this.setPhase("thinking");
    }
  }

  stop() {
    this.stopped = true;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ event: "stop" }));
    this.ws?.close();
    this.cleanup();
  }

  private cleanup() {
    this.processor?.disconnect();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.playing.forEach((n) => n.stop());
    this.playing = [];
    const ctx = this.ctx;
    this.ctx = null; // cleanup can run twice (stop + socket close); close the context once
    if (ctx) setTimeout(() => ctx.state !== "closed" && ctx.close(), 500);
    this.processor = null;
    this.mic = null;
    this.outAnalyser = null;
    this.micAnalyser = null;
  }
}
