/** Shared TTS helpers — Kokoro narrator (test page + game worker). */

export const TTS_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const TTS_DEFAULT_VOICE = "af_heart";
export const LOCAL_MODELS_BASE = "/local_models";
export const ORT_WASM_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

/** Strip markdown/formatting for speech. */
export function stripMarkdownForSpeech(text) {
  if (!text) return "";
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

/** Encode mono float32 [-1,1] samples as WAV blob. */
export function float32ToWavBlob(samples, sampleRate) {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Convert kokoro-js RawAudio to WAV blob. */
export function rawAudioToBlob(audio) {
  if (audio && typeof audio.toBlob === "function") return audio.toBlob();
  if (audio && typeof audio.save === "function" && audio.audio) {
    const a = audio.audio;
    return float32ToWavBlob(a.data || a, a.sampling_rate || 24000);
  }
  const rate = audio?.sampling_rate || audio?.sampleRate || 24000;
  let data = audio?.audio?.data ?? audio?.data ?? audio;
  if (data && typeof data === "object" && data.data) data = data.data;
  if (!(data instanceof Float32Array) && Array.isArray(data)) data = Float32Array.from(data);
  if (!(data instanceof Float32Array)) throw new Error("Unknown audio format from Kokoro");
  return float32ToWavBlob(data, rate);
}

export async function probeLocalTts() {
  if (!["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname)) return false;
  try {
    const r = await fetch(`${LOCAL_MODELS_BASE}/${TTS_MODEL_ID}/config.json`, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * kokoro-js exports env with only wasmPaths — NOT env.backends.onnx.
 * Transformers.js env (localModelPath, allowRemoteModels) is a separate import.
 */
export function applyKokoroEnv(kokoroEnv, tfEnv, { useLocal = false } = {}) {
  kokoroEnv.wasmPaths = ORT_WASM_BASE;
  if (useLocal) {
    tfEnv.localModelPath = `${LOCAL_MODELS_BASE}/`;
    tfEnv.allowLocalModels = true;
    tfEnv.allowRemoteModels = false;
  } else {
    tfEnv.allowLocalModels = false;
    tfEnv.allowRemoteModels = true;
  }
}

/** Seed kokoro-js voice cache from local_models/ so offline speak works. */
export async function seedLocalVoiceCache(voice = TTS_DEFAULT_VOICE) {
  const hfUrl = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${voice}.bin`;
  const localUrl = `${LOCAL_MODELS_BASE}/${TTS_MODEL_ID}/voices/${voice}.bin`;
  try {
    const r = await fetch(localUrl);
    if (!r.ok) return false;
    const buf = await r.arrayBuffer();
    const cache = await caches.open("kokoro-voices");
    await cache.put(hfUrl, new Response(buf));
    return true;
  } catch {
    return false;
  }
}
