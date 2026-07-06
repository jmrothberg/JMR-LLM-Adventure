#!/usr/bin/env python3
"""Download local_models/ assets for offline play: Gemma, SD 1.5, CLIP, Kokoro TTS."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from huggingface_hub import snapshot_download
except ImportError:
    print("Install huggingface_hub first: pip install huggingface_hub", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
LOCAL_MODELS = REPO_ROOT / "local_models"


def dl_gemma(local_dir: Path) -> None:
    print("→ Gemma 4 E4B ONNX (q4) ~3.1 GB")
    snapshot_download(
        "onnx-community/gemma-4-E4B-it-ONNX",
        allow_patterns=[
            "config.json",
            "generation_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "preprocessor_config.json",
            "processor_config.json",
            "chat_template.jinja",
            "onnx/decoder_model_merged_q4.onnx",
            "onnx/decoder_model_merged_q4.onnx_data",
            "onnx/decoder_model_merged_q4.onnx_data_1",
        ],
        local_dir=str(local_dir / "onnx-community/gemma-4-E4B-it-ONNX"),
    )


def dl_sd(local_dir: Path) -> None:
    print("→ SD 1.5 WebNN ONNX (fp16) ~1.9 GB")
    snapshot_download(
        "microsoft/stable-diffusion-v1.5-webnn",
        allow_patterns=[
            "text-encoder.onnx",
            "sd-unet-v1.5-model-b2c4h64w64s77-float16-compute-and-inputs-layernorm.onnx",
            "Stable-Diffusion-v1.5-vae-decoder-float16-fp32-instancenorm.onnx",
        ],
        local_dir=str(local_dir / "microsoft/stable-diffusion-v1.5-webnn"),
    )


def dl_clip(local_dir: Path) -> None:
    print("→ CLIP tokenizer ~2 MB")
    snapshot_download(
        "Xenova/clip-vit-base-patch16",
        allow_patterns=["tokenizer.json", "tokenizer_config.json", "config.json"],
        local_dir=str(local_dir / "Xenova/clip-vit-base-patch16"),
    )


def dl_kokoro(local_dir: Path) -> None:
    print("→ Kokoro 82M TTS ONNX (q8) ~86 MB + default voice af_heart")
    base = local_dir / "onnx-community/Kokoro-82M-v1.0-ONNX"
    snapshot_download(
        "onnx-community/Kokoro-82M-v1.0-ONNX",
        allow_patterns=[
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "onnx/*.onnx",
            "onnx/*.onnx_data*",
            "voices/af_heart.bin",
        ],
        local_dir=str(base),
    )


ALL = ("gemma", "sd", "clip", "kokoro", "tts")


def main() -> None:
    p = argparse.ArgumentParser(description="Download browser adventure models into local_models/")
    p.add_argument(
        "--only",
        choices=ALL,
        nargs="+",
        help="Download subset only (default: all). 'tts' is alias for kokoro.",
    )
    p.add_argument("--dir", type=Path, default=LOCAL_MODELS, help="Target directory (default: local_models/)")
    args = p.parse_args()

    local_dir = args.dir.resolve()
    local_dir.mkdir(parents=True, exist_ok=True)

    want = set(args.only) if args.only else set(ALL)
    if "tts" in want:
        want.discard("tts")
        want.add("kokoro")

    if "gemma" in want:
        dl_gemma(local_dir)
    if "sd" in want:
        dl_sd(local_dir)
    if "clip" in want:
        dl_clip(local_dir)
    if "kokoro" in want:
        dl_kokoro(local_dir)

    print(f"\nDone. Models in {local_dir}")
    print("Serve with: python3 scripts/serve-threaded.py")
    print("Test TTS:   http://localhost:8080/browser_adventure/tts_test.html")


if __name__ == "__main__":
    main()
