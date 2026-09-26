#!/bin/sh
# The first Node process in a dependency bootstrap must not inherit the caller's
# profile, npm configuration, preload hooks, provider credentials, or proxies.
set -eu

fail() { printf 'Dependency bootstrap: %s\n' "$1" >&2; exit 2; }
[ "$#" -eq 4 ] || fail 'Usage: sh scripts/bootstrap-deps.sh <toolchain|ci> <24.16.0|26.1.0> <absolute bootstrap Node> <absolute npm CLI>'
case "$1" in toolchain|ci) ;; *) fail 'Choose toolchain or ci.' ;; esac
case "$2" in 24.16.0|26.1.0) ;; *) fail 'Choose exact Node 24.16.0 or 26.1.0.' ;; esac
case "$3" in /*) ;; *) fail 'Bootstrap Node must be an absolute executable path.' ;; esac
case "$4" in /*) ;; *) fail 'npm CLI must be an absolute file path.' ;; esac
[ -x "$3" ] || fail 'Bootstrap Node is not executable.'
[ -f "$4" ] || fail 'npm CLI is missing.'

project=$(pwd -P)
case "$0" in */*) script_parent=${0%/*} ;; *) fail 'Invoke the launcher from this checkout.' ;; esac
script_dir=$(CDPATH= cd -P "$script_parent" && pwd -P) || fail 'Cannot resolve launcher directory.'
[ "$script_dir" = "$project/scripts" ] || fail 'Invoke the launcher from its own checkout root.'
[ ! -L "$project/scripts/bootstrap-deps.sh" ] || fail 'Launcher symlink is not admitted.'
[ ! -L "$project/scripts/bootstrap-deps.mjs" ] || fail 'Helper symlink is not admitted.'
[ -f "$project/scripts/bootstrap-deps.mjs" ] || fail 'Bootstrap helper is missing.'
[ -f "$project/package.json" ] && [ ! -L "$project/package.json" ] || fail 'Project manifest is missing or linked.'
[ -f "$project/package-lock.json" ] && [ ! -L "$project/package-lock.json" ] || fail 'Project lockfile is missing or linked.'

private="$project/.dev-profile/bootstrap"
for dir in "$project/.dev-profile" "$private" "$private/home" "$private/config" "$private/data" "$private/cache" "$private/tmp" "$private/state" "$private/browser" "$private/npm-cache" "$private/npm-global" "$private/stages"; do
  [ ! -L "$dir" ] || fail "Symlink in bootstrap path: $dir"
  if [ -e "$dir" ]; then
    [ -d "$dir" ] || fail "Bootstrap path is not a directory: $dir"
  else
    /usr/bin/env -i PATH=/usr/bin:/bin /bin/mkdir -m 700 "$dir" || fail "Cannot create private directory: $dir"
  fi
  actual=$(CDPATH= cd -P "$dir" && pwd -P) || fail "Cannot resolve private directory: $dir"
  [ "$actual" = "$dir" ] || fail "Bootstrap path escaped this checkout: $dir"
done

exec /usr/bin/env -i \
  PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  HOME="$private/home" OPENCLAW_HOME="$private/home" \
  OPENCLAW_CONFIG_PATH="$private/config/openclaw.json" OPENCLAW_STATE_DIR="$private/state" \
  XDG_CONFIG_HOME="$private/config" XDG_DATA_HOME="$private/data" XDG_CACHE_HOME="$private/cache" \
  TMPDIR="$private/tmp" TMP="$private/tmp" TEMP="$private/tmp" \
  PLAYWRIGHT_BROWSERS_PATH="$private/browser" CHROME_USER_DATA_DIR="$private/browser" \
  npm_config_userconfig="$private/config/npm-user.npmrc" \
  npm_config_globalconfig="$private/config/npm-global.npmrc" \
  npm_config_cache="$private/npm-cache" npm_config_prefix="$private/npm-global" \
  LOOPS_BOOTSTRAP_PROJECT="$project" LOOPS_BOOTSTRAP_PHASE="$1" \
  LOOPS_BOOTSTRAP_VERSION="$2" LOOPS_BOOTSTRAP_NODE_BIN="$3" LOOPS_BOOTSTRAP_NPM_CLI="$4" \
  "$3" "$project/scripts/bootstrap-deps.mjs"
