#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/.dev-runtime/node_modules/.bin:$PWD/node_modules/.bin:$PATH"
export OPENCLAW_STATE_DIR="$PWD/.dev-profile/codex-test/state"
export OPENCLAW_CONFIG_PATH="$PWD/.dev-profile/codex-test/openclaw.json"
export OPENCLAW_LOG_LEVEL=info

if [[ "${1:-}" == setup ]]; then
  node scripts/init-codex-profile.mjs
  if ! openclaw plugins info codex --json >/dev/null 2>&1; then
    openclaw plugins install @openclaw/codex --accept-capabilities
  fi
  if ! openclaw plugins info loops-poc --json >/dev/null 2>&1; then
    package_file=$(node --input-type=module -e 'import {readFileSync} from "node:fs"; const p=JSON.parse(readFileSync("package.json","utf8")); console.log(`${p.name}-${p.version}.tgz`);')
    openclaw plugins install "npm-pack:$PWD/$package_file" --force --accept-capabilities
  fi
  node scripts/init-codex-profile.mjs finish
  exec openclaw config validate
fi

if [[ ! -f "$OPENCLAW_CONFIG_PATH" ]]; then
  echo 'Run bash scripts/codex.sh setup first.' >&2
  exit 1
fi
if [[ "${1:-}" == copy-secret ]]; then
  node --input-type=module -e 'import {readFileSync} from "node:fs"; const c=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,"utf8")); process.stdout.write(c.gateway.auth.token);' | pbcopy
  echo 'Gateway secret copied. Paste it into this test profile’s Control UI connection form.'
  exit 0
fi
exec openclaw "$@"
