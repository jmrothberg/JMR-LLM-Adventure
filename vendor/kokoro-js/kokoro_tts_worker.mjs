/**
 * Kokoro TTS Web Worker — WASM q8, CPU-only (no WebGPU contention with Gemma/SD).
 * Default voice: af_heart (fetched from HF voices/ on first use).
 */
import { KokoroTTS, env as kokoroEnv } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
import { env as tfEnv } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/+esm";
import {
  TTS_MODEL_ID, TTS_DEFAULT_VOICE, rawAudioToBlob, applyKokoroEnv, seedLocalVoiceCache,
} from "./kokoro_shared.mjs";

let tts = null;
let genToken = 0;

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;
  const { kind } = msg;

  if (kind === "load") {
    const id = msg.id || uid();
    try {
      applyKokoroEnv(kokoroEnv, tfEnv, { useLocal: !!msg.useLocal });
      if (msg.useLocal) await seedLocalVoiceCache(msg.voice || TTS_DEFAULT_VOICE);
      tts = await KokoroTTS.from_pretrained(TTS_MODEL_ID, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p) => {
          if (p?.status === "progress" && p.file) {
            self.postMessage({ type: "progress", id, file: p.file, progress: p.progress });
          }
        },
      });
      self.postMessage({ type: "result", id, ok: true, device: "wasm", useLocal: !!msg.useLocal });
    } catch (e) {
      self.postMessage({ type: "result", id, ok: false, error: e.message || String(e) });
    }
    return;
  }

  if (kind === "generate") {
    const id = msg.id || uid();
    const myToken = ++genToken;
    try {
      if (!tts) throw new Error("Kokoro not loaded");
      const raw = await tts.generate(msg.text, { voice: msg.voice || TTS_DEFAULT_VOICE });
      if (myToken !== genToken) {
        self.postMessage({ type: "result", id, ok: false, cancelled: true });
        return;
      }
      const blob = rawAudioToBlob(raw);
      const buf = await blob.arrayBuffer();
      self.postMessage({ type: "result", id, ok: true, audio: buf, mime: "audio/wav" }, [buf]);
    } catch (e) {
      self.postMessage({ type: "result", id, ok: false, error: e.message || String(e) });
    }
    return;
  }

  if (kind === "cancel") {
    genToken++;
    self.postMessage({ type: "cancelled" });
  }
};
