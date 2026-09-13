# Deployment and lifecycle

This is a development alpha. The supported host contract is OpenClaw 2026.9.3; local source and package evidence covers macOS and a Linux arm64 VM with Node 24.16.0 and 26.1.0. Compiled package files match across those platforms. The public repository runs [hosted CI](https://github.com/Jacob-J-Thomas/openclaw-loops/actions/workflows/verify.yml) for macOS/Linux and both Node versions. Check its exact commit and [delivery status](DELIVERY_STATUS.md); a workflow's existence is not passing evidence or deployment acceptance.

[Hosted run 34717699050](https://github.com/Jacob-J-Thomas/openclaw-loops/actions/runs/34717699050) verifies source and packaged SDK tests on macOS arm64 and Linux x64 for both Node versions, including real Linux filesystem-full recovery. All four package hashes match. This adds hosted build/test evidence; real Codex/Ollama calls and complete deployment-role acceptance remain separate checks.

## Individual

Install the packaged plugin with OpenClaw's normal plugin installer, enable it in the profile, and open its native Loops page. Authoring and execution tools use the active host conversation. A new loop is enabled by default unless its author explicitly requests a draft. Generation controls inherit by omission. Do not add a per-plugin model allowlist unless the operator wants one. Existing host policy remains authoritative.

Run history belongs to its originating agent/session/session generation. The library is Gateway-wide. With OpenClaw 2026.9.3, conversation reset and durable requester-bound delivery are pending upstream contracts; do not promise cross-reset run control or background completion notifications yet.

## Shared team

Use a trusted OpenClaw Gateway and its established operator scopes. Read-only operators can browse permitted library/session data; operator-write can author and activate; an explicit Human review requires the admin human path. Loop tools grant no privilege beyond the caller's host authority. The plugin does not currently implement separate project ownership or per-loop sharing ACLs. Do not represent Gateway-wide library access as tenant isolation.

Stable user identity, session visibility after reset, and request-bound invocation/delivery are required host contracts for the complete shared-team release. Use the existing runtime and issue-led upstream additions; no custom jobs API is selected. See [UPSTREAM_REQUIREMENTS.md](UPSTREAM_REQUIREMENTS.md).

## Independent customers

Use one Gateway, state directory, credentials, workspace and model authorization boundary per customer. Never point separate Gateways at one Loops database. The SQLite lock rejects a competing writer. Shared workers would require an explicit authenticated execution protocol and are not provided by this alpha. The deliverable covers plugin deployment and validation; customer provisioning, signup and billing are outside scope.

## Local inference on 16 GB unified memory

The isolated development profile uses Ollama `qwen3.5:4b`, Q4_K_M, 32,768 context tokens, one loaded model and one inference worker. Its observed loaded-model allocation was 3,705,048,922 bytes; this excludes other apps and runtime allocations. Keep Loops `maxConcurrentRuns` at 1 for this setup. A 16K context worked for individual completion nodes but overflowed during an actual agent tool-discovery/result-reporting turn; 32K completed that journey. This is measured local behavior, not a universal memory guarantee.

`scripts/init-profile.mjs` preserves existing configurations and repairs only the recognizable generated one-model policy. Review custom profiles individually. The dev scripts use dedicated state and config paths; they never initialize the personal assistant profile.

## Upgrade

1. Keep the previous plugin artifact and stop the affected Gateway so no host calls are active.
2. Back up the entire profile state and configuration as a matched pair, including `loops-poc/loops.sqlite`, any WAL files and `loops-poc/documents` (immutable large responses and staged requests). A stopped Gateway is required for a raw filesystem copy. The storage adapter's SQLite backup operation snapshots the database alone; it does not coordinate live document/upload files or replace a complete stopped-profile backup.
3. Install the new artifact through OpenClaw. On first SQLite startup, legacy JSON is validated, copied to a timestamped backup and imported transactionally. The original JSON is retained. Integrity and exact readback are checked. Alpha.6 also backs up a schema 1 SQLite database before transactionally upgrading it to schema 2 for immutable history-removal admission records.
4. Restart, check plugin startup, compare library identities/revisions and run history counts, then run a synthetic command/tool/UI smoke test. Existing runs keep their pinned definitions. Uncertain interrupted effects require an explicit inspected recovery decision.

Do not copy a live SQLite main file without its transactional state. Do not delete the original JSON/backup as part of upgrade acceptance.

History retention and its explicit UI/agent cleanup policy are documented in [HISTORY.md](HISTORY.md). Cleanup is disabled until requested; no upgrade deletes old history automatically.

## Storage ownership and crash recovery

Alpha.10 holds a SQLite transaction on the separate `loops.sqlite.owner.sqlite` lease file before recovering a stale PID marker. The lease contains no loop/run state and remains held until the storage worker physically stops. Its file is deliberately retained after shutdown: never unlink or replace a live lease file to resolve contention. All application state remains in `loops.sqlite`. Use local filesystems; shared/network-filesystem ownership is not established by the local tests.

The Gateway accesses the engine through an asynchronous plugin-owned service worker. The engine's synchronous commit barriers and its nested SQLite worker execute off the Gateway thread. A blocked database transaction therefore delays Loops operations without blocking unrelated Gateway timers or requests. Startup awaits verified committed state; shutdown joins the worker tree before allowing a replacement storage owner. The database schema, plugin identity and revision semantics remain unchanged. Stop/restart the Gateway for this upgrade; hot replacement alongside an older executor is unsupported.

Authenticated host invocation objects stay in the Gateway. Private worker messages identify the original invocation and its pinned model/reasoning/account settings; all authority checks and model calls still use the existing public OpenClaw adapter. Invocation references are retained only while requests, queued/active execution or physical host promises need them. Request signals and cancellation are forwarded across the worker boundary. A settled local worker or host promise still does not prove a remote provider stopped its work; durable cancellation receipts remain the SDK06 dependency.

The complete PID marker is published atomically. The lease makes modern stale-marker recovery independent of PID reuse, while a live legacy PID marker still rejects startup. Stop the old Gateway before upgrades or rollback; simultaneous mixed-version ownership is unsupported. An incomplete legacy marker requires checking the old owning process before manual recovery. Temporary `.lock.starting-*` directories left by a crash before publication can be removed while the Gateway is stopped; they contain only ownership metadata.

Restart preserves committed outputs, waits, human decisions and admission identities. Incomplete attempts remain inspectable and require explicit recovery. A stale `cleanupPending` flag from the stopped process is cleared while its uncertain external outcome remains recorded; clearing that flag does not claim an external provider call was cancelled successfully. No unknown call is automatically replayed.

Tests kill disposable real storage/engine processes at ownership, transaction and execution boundaries. The full-database fixture uses SQLite's page-count limit to produce `SQLITE_FULL`. A separate alpha.11 check fills a disposable 16 MB Linux tmpfs until `ENOSPC`, verifies admission rejects before any host effect with committed data unchanged, then frees space and proves recovery with a fresh explicit request on Node 24 and 26. It refuses non-tmpfs, nonempty or larger fault volumes. The Mac's filesystem is never filled. OS power loss, APFS exhaustion and remote provider cancellation remain separate acceptance work.

Alpha.12 repeats the real filesystem-full check on both Linux Node versions and returns `LOOPS_STORAGE_FULL`, phase `storage`, with explicit recovery guidance. Storage access, locking, corruption, I/O, conflicts and uncertain acknowledgements have separate codes. Provider failures retain node/model attribution while raw credentials, request bodies and URLs stay out of shared run diagnostics. The run inspector and agent receipts show those details; commands show the code and recovery step. A retryable error is a diagnosis, not an automatic retry or proof that an external effect did not occur.

Alpha.11 execution checkpoints transfer and update only their changed run, preserving the same SQLite transaction and acknowledgement boundary. Alpha.13 removes the worker's complete-history cache and compares changes against committed rows. Alpha.15 also removes the engine's historical-output cache: startup loads definitions/revisions and unfinished execution/cleanup, while owner-scoped history pages and individual parked/completed runs load through SQLite queries. Authoring merges the working set without rewriting or deleting omitted history. Explicit retention atomically deletes its selected rows and retains their admission identities. These changes add compatible indexes without changing database schema version 2 or the saved run format.

With identical stopped databases containing 1,000 synthetic runs (about 90.6 MB), the alpha.15 comparison measured main-process heap after startup at 7,073,928 bytes versus 99,969,776 bytes for alpha.14. Startup was 324 ms versus 988 ms; a 50-row history page took 3.8 ms versus 8.7 ms. Both builds returned the same complete output hash and passed SQLite integrity checks. The measurement used separate Node 24 processes with explicit garbage collection. It predates the service-worker boundary and does not measure current peak memory, model latency or general production capacity. Definitions/revisions and active runs still require memory; full inspection loads one complete run and retention scans compact metadata. Wider resource/soak acceptance remains open. Immutable document and staged-upload I/O remain a separate maintenance work item; the service worker does not move host-owned synchronous APIs off the Gateway thread.

## Rollback

Stop the Gateway. Restore the previous artifact together with its matching profile/database backup. Do not run an older plugin against a newer unsupported state format or overwrite the backup to make it appear compatible. Keep the failed upgrade's state separately for diagnosis. Restart and run the same synthetic smoke test.

For each stopped backup, retain the exact plugin archive and its SHA-256, the OpenClaw and Node versions, the host profile/configuration needed to resolve its original sessions, and every plugin-owned database/document file. A package version string alone is insufficient to distinguish development artifacts. Record definition/revision/run counts and hashes of representative complete outputs and immutable document pages. Keep the backup separate from the working restore so validation and subsequent runs cannot modify the rollback input.

Before starting a restore, verify the archive and copied-file hashes against that inventory. Restore through the ordinary plugin installer with the matched host/profile configuration, then validate the library/publication, historical revisions, complete results, waits/reviews and staged uploads in their original authorized conversations. Confirm database integrity and counts before creating new smoke-test runs; then account for those additions. A host profile/session migration is governed by OpenClaw's supported recovery procedures. Loops does not rewrite host session identities to make a copied customer profile appear authorized.

Newer database schema versions are rejected before any journal-mode change. The refusal preserves the database bytes and future-format records instead of partially converting a rollback input. Corrupt restored copies are rejected and preserved for diagnosis. If a legacy JSON import transaction fails, the original JSON and its backup survive, no partial loop/revision/run rows are accepted, and an explicit retry can proceed after the storage fault is corrected. Never "repair" incompatibility by editing `user_version` or deleting evidence.

The matched-restore regression runs through the published feature SDK against real disposable SQLite/document files. `npm run check` exercises source and restored compiled runtime files; `node scripts/verify-package.mjs` repeats the journey using the extracted publication artifact, including its compiled UI asset. It compares copied application/state hashes, five definitions and two original runs, complete Unicode output/document digests, two immutable revisions, continuation of a pinned wait and a partial upload, and the unchanged backup after new restored work. Host identity/model transport in this fixture is synthetic; real Gateway installation/recovery receipts are separate evidence.

## Disable and uninstall

Disable the plugin through OpenClaw, stop/drain the affected Gateway, and use the host plugin uninstall command. Disable or uninstall must not be treated as consent to erase definitions, history or backups. Keep the plugin-owned state directory for reinstall/recovery. Erasing retained state is a separate deliberate data-deletion operation.

## Release evidence

The publication gate requires an exact package hash, passing CI, the host/deployment matrix, migration/rollback evidence, ClawHub dry run and publication, then a clean registry installation. Synthetic local evidence and publication status are in [VERIFICATION.md](VERIFICATION.md) and [DELIVERY_STATUS.md](DELIVERY_STATUS.md). No registry release has been made.
