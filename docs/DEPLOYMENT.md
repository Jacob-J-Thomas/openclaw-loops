# Deployment and lifecycle

This is an unreleased alpha. The supported host contract is OpenClaw 2026.9.3; local evidence currently covers macOS with Node 24.16.0. The workflow tests macOS/Linux and Node 24.16.0/26.1.0 when run in GitHub. A workflow file alone is not compatibility evidence.

## Individual

Install the packaged plugin with OpenClaw's normal plugin installer, enable it in the profile, and open its native Loops page. Authoring and execution tools use the active host conversation. A new loop is enabled by default unless its author explicitly requests a draft. Generation controls inherit by omission. Do not add a per-plugin model allowlist unless the operator wants one. Existing host policy remains authoritative.

Run history belongs to its originating agent/session/session generation. The library is Gateway-wide. With OpenClaw 2026.9.3, conversation reset and durable requester-bound delivery are pending upstream contracts; do not promise cross-reset run control or background completion notifications yet.

## Shared team

Use a trusted OpenClaw Gateway and its established operator scopes. Read-only operators can browse permitted library/session data; operator-write can author and activate; an explicit Human review requires the admin human path. Loop tools grant no privilege beyond the caller's host authority. The plugin does not currently implement separate project ownership or per-loop sharing ACLs. Do not represent Gateway-wide library access as tenant isolation.

Stable user identity, session visibility after reset, and requester-bound jobs are required upstream work for the complete shared-team release. See [UPSTREAM_REQUIREMENTS.md](UPSTREAM_REQUIREMENTS.md).

## Independent customers

Use one Gateway, state directory, credentials, workspace and model authorization boundary per customer. Never point separate Gateways at one Loops database. The SQLite lock rejects a competing writer. Shared workers would require an explicit authenticated execution protocol and are not provided by this alpha. The deliverable covers plugin deployment and validation; customer provisioning, signup and billing are outside scope.

## Local inference on 16 GB unified memory

The isolated development profile uses Ollama `qwen3.5:4b`, Q4_K_M, 32,768 context tokens, one loaded model and one inference worker. Its observed loaded-model allocation was 3,705,048,922 bytes; this excludes other apps and runtime allocations. Keep Loops `maxConcurrentRuns` at 1 for this setup. A 16K context worked for individual completion nodes but overflowed during an actual agent tool-discovery/result-reporting turn; 32K completed that journey. This is measured local behavior, not a universal memory guarantee.

`scripts/init-profile.mjs` preserves existing configurations and repairs only the recognizable generated one-model policy. Review custom profiles individually. The dev scripts use dedicated state and config paths; they never initialize the personal assistant profile.

## Upgrade

1. Keep the previous plugin artifact and stop the affected Gateway so no host calls are active.
2. Back up the entire profile state and configuration as a matched pair, including `loops-poc/loops.sqlite`, any WAL files and `loops-poc/documents` (immutable large responses and staged requests). A stopped Gateway is required for a raw filesystem copy; the storage adapter's SQLite backup operation is suitable for a live database snapshot.
3. Install the new artifact through OpenClaw. On first SQLite startup, legacy JSON is validated, copied to a timestamped backup and imported transactionally. The original JSON is retained. Integrity and exact readback are checked.
4. Restart, check plugin startup, compare library identities/revisions and run history counts, then run a synthetic command/tool/UI smoke test. Existing runs keep their pinned definitions. Uncertain interrupted effects require an explicit inspected recovery decision.

Do not copy a live SQLite main file without its transactional state. Do not delete the original JSON/backup as part of upgrade acceptance.

## Rollback

Stop the Gateway. Restore the previous artifact together with its matching profile/database backup. Do not run an older plugin against a newer unsupported state format or overwrite the backup to make it appear compatible. Keep the failed upgrade's state separately for diagnosis. Restart and run the same synthetic smoke test.

## Disable and uninstall

Disable the plugin through OpenClaw, stop/drain the affected Gateway, and use the host plugin uninstall command. Disable or uninstall must not be treated as consent to erase definitions, history or backups. Keep the plugin-owned state directory for reinstall/recovery. Erasing retained state is a separate deliberate data-deletion operation.

## Release evidence

The publication gate requires an exact package hash, passing CI, the host/deployment matrix, migration/rollback evidence, ClawHub dry run and publication, then a clean registry installation. Synthetic local evidence and publication status are in [VERIFICATION.md](VERIFICATION.md) and [DELIVERY_STATUS.md](DELIVERY_STATUS.md). No registry release has been made.
