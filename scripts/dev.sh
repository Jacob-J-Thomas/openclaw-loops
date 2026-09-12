#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/.dev-runtime/node_modules/.bin:$PWD/node_modules/.bin:$PATH"
export OPENCLAW_STATE_DIR="$PWD/.dev-profile/state"
export OPENCLAW_CONFIG_PATH="$PWD/.dev-profile/openclaw.json"
export OPENCLAW_LOG_LEVEL=info
exec openclaw "$@"
