#!/bin/sh
# Seed the whisper.cpp model into the cache volume, then serve it.
#
# The image bakes the model at /opt/whisper/models; the named volume mounted at
# /models starts empty on first boot (Docker seeds it from the image's empty
# /models dir). Copy once, then reuse across restarts. No network needed.
set -eu

MODELS_DIR="${WHISPER_MODELS_DIR:-/models}"
MODEL_NAME="${WHISPER_MODEL:-small.en}"
MODEL_PATH="${WHISPER_MODEL_PATH:-${MODELS_DIR}/ggml-${MODEL_NAME}.bin}"

if [ ! -f "$MODEL_PATH" ]; then
  BAKED="/opt/whisper/models/ggml-${MODEL_NAME}.bin"
  if [ ! -f "$BAKED" ]; then
    echo "whisper: no model at ${MODEL_PATH} or ${BAKED}; cannot serve" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$MODEL_PATH")"
  cp "$BAKED" "$MODEL_PATH"
fi

# --convert lets the server accept webm/ogg/etc. via the bundled ffmpeg.
exec whisper-server \
  --model "$MODEL_PATH" \
  --host 0.0.0.0 \
  --port "${WHISPER_PORT:-4001}" \
  --threads "${WHISPER_THREADS:-4}" \
  --convert \
  "$@"
