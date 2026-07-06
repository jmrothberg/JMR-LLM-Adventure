/**
 * Main-thread client for Kokoro TTS worker (lazy load, generate WAV blob).
 */
import { TTS_DEFAULT_VOICE } from "./kokoro_shared.mjs";

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class KokoroTtsClient {
  constructor() {
    this.worker = new Worker(new URL("./kokoro_tts_worker.mjs", import.meta.url), { type: "module" });
    this.pending = new Map();
    this.loaded = false;
    this.worker.addEventListener("message", (ev) => this._onMessage(ev));
  }

  _onMessage(ev) {
    const msg = ev.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "progress") return;
    const id = msg.id;
    if (!id || !this.pending.has(id)) return;
    const { resolve, reject } = this.pending.get(id);
    this.pending.delete(id);
    if (msg.ok) resolve(msg);
    else if (msg.cancelled) resolve(msg);
    else reject(new Error(msg.error || "Kokoro TTS failed"));
  }

  _send(payload) {
    const id = payload.id || uid();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...payload, id });
    });
  }

  /** Load Kokoro WASM q8 model (once). voice seeds offline cache when useLocal. */
  async load({ useLocal = false, voice = TTS_DEFAULT_VOICE, onProgress } = {}) {
    if (this.loaded) return { ok: true, cached: true };
    const progressSeen = new Set();
    const onProg = (ev) => {
      const m = ev.data;
      if (m?.type !== "progress" || !m.file || progressSeen.has(m.file)) return;
      progressSeen.add(m.file);
      onProgress?.(m.file);
    };
    this.worker.addEventListener("message", onProg);
    try {
      const res = await this._send({ kind: "load", useLocal, voice });
      if (res.ok) this.loaded = true;
      return res;
    } finally {
      this.worker.removeEventListener("message", onProg);
    }
  }

  /** Generate speech WAV; returns Blob. */
  async generate(text, voice = TTS_DEFAULT_VOICE) {
    const res = await this._send({ kind: "generate", text, voice });
    if (res.cancelled) return null;
    if (!res.audio) throw new Error("No audio returned");
    return new Blob([res.audio], { type: res.mime || "audio/wav" });
  }

  cancel() {
    this.worker.postMessage({ kind: "cancel" });
  }

  terminate() {
    this.worker.terminate();
    this.loaded = false;
  }
}

export { stripMarkdownForSpeech, TTS_DEFAULT_VOICE, probeLocalTts } from "./kokoro_shared.mjs";
