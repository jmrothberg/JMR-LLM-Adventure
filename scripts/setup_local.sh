#!/usr/bin/env bash
# Download all browser adventure models to local_models/ for fully offline play.
# Usage: ./scripts/setup_local.sh   (from repo root)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== JMR LLM Adventure — local model setup (~5.2 GB) ==="
echo "Repo: $ROOT"
echo ""

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 not found." >&2
  exit 1
fi

echo "→ Installing huggingface_hub (if needed)…"
python3 -m pip install -q huggingface_hub

echo "→ Downloading Gemma + SD 1.5 + CLIP + Kokoro TTS…"
python3 scripts/download_models.py

echo ""
echo "=== Done ==="
echo "Models saved to: $ROOT/local_models/"
echo ""
echo "Start the game (COOP/COEP for WASM threads):"
echo "  python3 scripts/serve-threaded.py"
echo ""
echo "Open:"
echo "  Game:     http://localhost:8080/browser_adventure/adventure.html"
echo "  TTS test: http://localhost:8080/browser_adventure/tts_test.html"
echo ""
echo "After this one-time download, Gemma, SD, and Kokoro run fully offline on localhost."
