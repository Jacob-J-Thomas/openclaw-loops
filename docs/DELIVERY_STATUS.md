# Delivery status

Active scope: all requirements in [DELIVERY_PLAN.md](DELIVERY_PLAN.md), including expansion milestones.

## Baseline

- Source: 0.3.0, OpenClaw 2026.9.3. All initial project files were untracked; no baseline source was overwritten without a private archive.
- Before-work archive: `.dev-profile/backups/source-0.3.0-before-release-work.tgz` (local only).
- Existing evidence: 61 deterministic tests from the audit; earlier packaged and real command/tool/UI POC checks in `evidence/` and `docs/VERIFICATION.md`. These do not establish 1.0 readiness.

## Progress

| Requirements | State | Evidence / next gate |
|---|---|---|
| R01 | Implemented; local profile verification | Recognizable generated policy repair with backups and repeatable setup; custom-policy regressions. |
| R02/R03/R18 | Partial; source and live evidence | Advanced descriptors, explicit zero, inherited generation/model/reasoning settings, preflight and attribution. V2 timeout inheritance added. Host runtime/account parity and unsupported sampling require SDK01/02. Live Codex and Ollama calls proven; model/provider matrix remains. |
| R04 | Partial | Main-agent-only filter removed; trusted host session checks retained. Stable principal and reset/history authority require SDK03. |
| R05/R06/R09 | Implemented; regression evidence | Structured execution errors, producer fields, unused truthy operand, fresh intentional command IDs and canonical retry fingerprints. Broader transport failures remain in scenario matrix. |
| R07/R08 | Partial; regression evidence | Commit rollback, SQLite transaction conflicts, immutable revision/grant preservation. Process-crash/disk-full transition matrix remains. |
| R10 | Implemented backend; partial UI | Immutable versions, draft/publication, restore/archive/delete/recover; version UI. Archive/recovery UI and three-way conflict merge implemented; expanded multi-user acceptance remains. |
| R11/R12 | Partial; local migration verified | SQLite worker/WAL/locking/integrity/backup, exact legacy backup/import, attempt evidence, explicit recovery ancestry. Store still loads complete state and waits at synchronous commit barriers; scalability, crash-point testing and durable wake remain. |
| R13/R14/R16 | Partial | Configurable queued concurrency, physical cleanup accounting, no 20/50 record caps, paged Unicode outputs/history, immutable result documents and chunked input uploads. Actual SDK and installed Codex/UI large-data checks pass. Retention policy, backend pagination/scale and physical-failure soak remain. |
| R15 | Partial | V2 nested JSON, zero-input graphs, safe traversal, typed equality and larger explicit budgets. Operator definition/input/prompt budgets and new-graph defaults now configure through the manifest; saved evidence stays readable after budget reductions. Larger-scale and further schema validation remain. |
| R17 | Partial | 30 agent tools; real agent invocation/lifecycle tests; concrete output schemas; authenticated human command review. Complete all-path and host identity/role coverage remain. |
| R19–R21 | Partial | Undo/redo, node duplication, layout, binding picker, search, draft recovery, version controls, unpublished tests and explicit recovery. Conflict merging, independent persistent browser drafts (including unfinished invalid edits) and archive recovery implemented; live draft/archive journeys pass. Full history scale and remaining authoring/a11y journeys remain. |
| R22 | Partial | Empty invalidation events followed by authorized fetch. Durable requester-bound delivery needs SDK04. |
| R23 | Partial | Keyboard authoring controls, contrast/theme/responsive CSS, native Advanced zero-value UI proof. Full light/dark, keyboard, small-screen and accessibility acceptance remains. |
| R24 | Partial | 105 source tests and installed alpha.5 artifact (19 extracted-package SDK tests), package SDK checks, two isolated dev profiles, SQLite migration and real model calls. Earlier Ollama agent reporting passed with the same 4B model at 32K after a 16K overflow; alpha.5 repeated-input acceptance exposed model reuse/wrong-input behavior, and a clean exact-arguments rerun passed fresh-input/ID assertions. Feature-matrix success/review/restart path passed with Sol. Deployment/OS/resource/soak/upgrade matrix remains. |
| R25 | Partial | MIT license, 27 dependency notices, contributor/deployment guides, pinned CI workflow, installable alpha tarball and upstream gap contracts. Public source/CI, dry run, publication and fresh registry install remain. Public GitHub source creation/push was rejected by automatic approval review; specific payload approval is pending. |
| X01–X29 | Pending | All expansion milestones remain in the active goal. |

Live details and their limitations: [VERIFICATION.md](VERIFICATION.md). Public host dependencies: [UPSTREAM_REQUIREMENTS.md](UPSTREAM_REQUIREMENTS.md). These are documented requirements, not submitted or accepted upstream changes.

Release status: **not ready, not published, goal incomplete**. Update rows only with actual evidence; distinguish implementation from live verification.
