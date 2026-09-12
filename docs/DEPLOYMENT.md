# Deployment and lifecycle

This is an unreleased alpha. The supported host contract is OpenClaw 2026.9.3; local source and package evidence covers macOS and a Linux arm64 VM with Node 24.16.0 and 26.1.0. Compiled package files match across those platforms. The GitHub workflow is configured for macOS/Linux and both Node versions but has not run; native x64 and hosted CI remain unverified.

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
3. Install the new artifact through OpenClaw. On first SQLite startup, legacy JSON is validated, copied to a timestamped backup and imported transactionally. The original JSON is retained. Integrity and exact readback are checked. Alpha.6 also backs up a schema 1 SQLite database before transactionally upgrading it to schema 2 for immutable history-removal admission records.
4. Restart, check plugin startup, compare library identities/revisions and run history counts, then run a synthetic command/tool/UI smoke test. Existing runs keep their pinned definitions. Uncertain interrupted effects require an explicit inspected recovery decision.

Do not copy a live SQLite main file without its transactional state. Do not delete the original JSON/backup as part of upgrade acceptance.

History retention and its explicit UI/agent cleanup policy are documented in [HISTORY.md](HISTORY.md). Cleanup is disabled until requested; no upgrade deletes old history automatically.

## Storage ownership and crash recovery

Alpha.10 holds a SQLite transaction on the separate `loops.sqlite.owner.sqlite` lease file before recovering a stale PID marker. The lease contains no loop/run state and remains held until the storage worker physically stops. Its file is deliberately retained after shutdown: never unlink or replace a live lease file to resolve contention. All application state remains in `loops.sqlite`. Use local filesystems; shared/network-filesystem ownership is not established by the local tests.

The complete PID marker is published atomically. The lease makes modern stale-marker recovery independent of PID reuse, while a live legacy PID marker still rejects startup. Stop the old Gateway before upgrades or rollback; simultaneous mixed-version ownership is unsupported. An incomplete legacy marker requires checking the old owning process before manual recovery. Temporary `.lock.starting-*` directories left by a crash before publication can be removed while the Gateway is stopped; they contain only ownership metadata.

Restart preserves committed outputs, waits, human decisions and admission identities. Incomplete attempts remain inspectable and require explicit recovery. A stale `cleanupPending` flag from the stopped process is cleared while its uncertain external outcome remains recorded; clearing that flag does not claim an external provider call was cancelled successfully. No unknown call is automatically replayed.

Tests kill disposable real storage/engine processes at ownership, transaction and execution boundaries. The full-database fixture uses SQLite's page-count limit to produce `SQLITE_FULL`. A separate alpha.11 check fills a disposable 16 MB Linux tmpfs until `ENOSPC`, verifies admission rejects before any host effect with committed data unchanged, then frees space and proves recovery with a fresh explicit request on Node 24 and 26. It refuses non-tmpfs, nonempty or larger fault volumes. The Mac's filesystem is never filled. OS power loss, APFS exhaustion and remote provider cancellation remain separate acceptance work.

Alpha.12 repeats the real filesystem-full check on both Linux Node versions and returns `LOOPS_STORAGE_FULL`, phase `storage`, with explicit recovery guidance. Storage access, locking, corruption, I/O, conflicts and uncertain acknowledgements have separate codes. Provider failures retain node/model attribution while raw credentials, request bodies and URLs stay out of shared run diagnostics. The run inspector and agent receipts show those details; commands show the code and recovery step. A retryable error is a diagnosis, not an automatic retry or proof that an external effect did not occur.

Alpha.11 execution checkpoints transfer and update only their changed run, preserving the same SQLite transaction and acknowledgement boundary. Authoring, startup/migration and explicit history removal still commit coordinated whole-state changes. At alpha.11, the worker and engine both retained complete state. Alpha.13 removes the worker cache and compares changes against committed SQLite rows inside the same transaction. A separate fixture with 1,000 retained runs measured settled worker heap at about 5.5 MB instead of 98 MB. Whole-process peak RSS did not reliably improve; the engine still loads complete state and lazy history loading/asynchronous commit barriers remain scalability work. A twelve-run synthetic benchmark with 1,000 retained runs (about 90.6 MB serialized) reduced mean loop execution time from 884 ms to 2.6 ms, with observed RSS falling from 3.3 GB to 1.3 GB. This measures local deterministic execution and storage, not model latency or a production capacity guarantee.

## Rollback

Stop the Gateway. Restore the previous artifact together with its matching profile/database backup. Do not run an older plugin against a newer unsupported state format or overwrite the backup to make it appear compatible. Keep the failed upgrade's state separately for diagnosis. Restart and run the same synthetic smoke test.

## Disable and uninstall

Disable the plugin through OpenClaw, stop/drain the affected Gateway, and use the host plugin uninstall command. Disable or uninstall must not be treated as consent to erase definitions, history or backups. Keep the plugin-owned state directory for reinstall/recovery. Erasing retained state is a separate deliberate data-deletion operation.

## Release evidence

The publication gate requires an exact package hash, passing CI, the host/deployment matrix, migration/rollback evidence, ClawHub dry run and publication, then a clean registry installation. Synthetic local evidence and publication status are in [VERIFICATION.md](VERIFICATION.md) and [DELIVERY_STATUS.md](DELIVERY_STATUS.md). No registry release has been made.
