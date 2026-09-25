#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
unset NODE_OPTIONS NODE_PATH
node_bin="${LOOPS_NODE_BIN:-${npm_node_execpath:-}}"
if [[ -z "$node_bin" ]]; then
  for candidate in "$PWD/.dev-profile/toolchains/node-24.16.0/node_modules/node/bin/node" "$PWD/.dev-runtime/node_modules/node/bin/node" "$PWD/.dev-runtime-node26/node_modules/node/bin/node"; do
    if [[ -x "$candidate" ]]; then node_bin="$candidate"; break; fi
  done
fi
if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
  echo 'Set LOOPS_NODE_BIN to a dedicated Node 24.16.0 or 26.1.0 executable.' >&2
  exit 1
fi
exec "$node_bin" scripts/isolated-runtime.mjs openclaw "$@"
