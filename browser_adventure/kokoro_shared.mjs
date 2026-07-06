/** Re-export vendor Kokoro helpers for tts_test.html. */
export * from "../vendor/kokoro-js/kokoro_shared.mjs";

/** WASM threads need crossOriginIsolated + SharedArrayBuffer. */
export function sdWasmThreadCount() {
  if (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated && navigator.hardwareConcurrency) {
    return Math.min(4, navigator.hardwareConcurrency);
  }
  return 1;
}
