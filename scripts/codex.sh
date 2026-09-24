#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export LOOPS_PROFILE=codex-test
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
export LOOPS_NODE_BIN="$node_bin"

if [[ "${1:-}" == setup ]]; then
  "$node_bin" scripts/init-codex-profile.mjs
  if ! bash scripts/dev.sh plugins info codex --json >/dev/null 2>&1; then
    bash scripts/dev.sh plugins install @openclaw/codex --accept-capabilities
  fi
  if ! bash scripts/dev.sh plugins info loops-poc --json >/dev/null 2>&1; then
    package_file=$("$node_bin" --input-type=module -e 'import {readFileSync} from "node:fs"; const p=JSON.parse(readFileSync("package.json","utf8")); console.log(p.name+"-"+p.version+".tgz");')
    bash scripts/dev.sh plugins install "npm-pack:$PWD/$package_file" --force --accept-capabilities
  fi
  "$node_bin" scripts/init-codex-profile.mjs finish
  exec bash scripts/dev.sh config validate
fi

if [[ ! -f "$PWD/.dev-profile/codex-test/openclaw.json" ]]; then
  echo 'Run bash scripts/codex.sh setup first.' >&2
  exit 1
fi
if [[ "${1:-}" == copy-secret ]]; then
  "$node_bin" --input-type=module -e 'import {profileEnvironment} from "./scripts/isolated-runtime.mjs"; profileEnvironment(process.cwd(),"codex-test");'
  "$node_bin" --input-type=module -e 'import {readFileSync} from "node:fs"; const c=JSON.parse(readFileSync(".dev-profile/codex-test/openclaw.json","utf8")); process.stdout.write(c.gateway.auth.token);' | pbcopy
  echo 'Gateway secret copied. Paste it into this test profile’s Control UI connection form.'
  exit 0
fi
exec bash scripts/dev.sh "$@"
