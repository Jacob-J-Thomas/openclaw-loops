# OpenClaw Loops: standalone 1.0 delivery plan

Revised scope, September 12, 2026. This replaces the earlier goal that included every expansion milestone. It incorporates the revised release contract and retains the separately requested Advanced inference settings. The original POC handoff and earlier acceptance entries remain historical evidence.

## Release sequence and boundaries

**Active goal: deliver and verify OpenClaw Loops 1.0 as a public, independently installable external OpenClaw plugin, using supported OpenClaw APIs for all host integration. Complete the necessary upstream issue contributions in separate OpenClaw PRs, adopt their released APIs, and verify installation from ClawHub before declaring 1.0 complete.**

The 1.0 palette is Input, Inference, configured-model Action, Condition, Repeat, manual Wait, Human review, Return and Fail. Action currently reads configured-model metadata; it is not an arbitrary tool or script node. Inference performs one fresh, tool-free completion. Repeat retains its inference/condition body. Full agent control includes creating enabled loops, optional drafts, publication, activation, invocation, inspection and deletion. Only an explicitly authored Human review requires a human decision.

All R01–R25 outcomes below are release requirements. X01–X29 are a deferred roadmap, not unfinished work in the active 1.0 goal. Their existing 1.0 subsets remain required: conversation invocation, nested JSON, explicit recovery and ordinary shared authoring. Adding an expansion family requires a subsequent goal after 1.0; it must not enter the 1.0 code or release package accidentally.

Support individual use, a shared team, and independent hosted customers. Use OpenClaw's identity and policy. Independent customers require separate Gateways, credentials, state and workspaces. Deliver the plugin, deployment guidance and validation for those scenarios, not a hosting business's signup, provisioning, billing or operations service.

Distribute under MIT, primarily through ClawHub. Preserve the plugin ID `loops-poc` and existing state identity through migration. Keep the package name separate from storage identity. Public source publication is authorized; the repository will contain the plugin, its tests, examples, documentation and development tooling. EmbodySense, OpenClaw runtime changes, provider implementations, personal profiles and hosting-service code are outside it. See the [repository and release boundary](RELEASE_SCOPE.md).

Loops owns graph semantics, its editor, definitions, SQLite database and execution records. OpenClaw owns credentials, account/model selection, permissions, runtime execution, host sessions and message delivery. Calling a public SDK export does not imply that an external plugin is entitled to every trusted-only method beneath it. Do not import private host internals, call providers directly, patch an installed Gateway or substitute administrator credentials for a missing API.

Use existing OpenClaw issues as the starting point for upstream work. Check the current source, released contract, issue scope and linked PR before implementing. Help complete an existing contributor's PR when it already covers the requirement; open a focused issue-linked PR only for uncovered work. Some issues are partial matches and some requested behavior has already shipped. The [upstream dependency register](UPSTREAM_REQUIREMENTS.md) records those distinctions and the unresolved requirements. The earlier custom jobs-API proposal is not the selected architecture.

## List 1: issues and limitations to resolve for 1.0

These are findings from the 0.3.0 implementation, not claims that every possible defect has been found.

| ID | Current issue | Required outcome |
|---|---|---|
| R01 | Dev setup inserts a one-model completion allowlist and overwrites it on repeated setup. | Repair recognizable generated policies with backups; preserve operator policies and settings; allow every host-authorized model by default. |
| R02 | Inference forces temperature 0.2, 512 output tokens and reasoning off. | Inherit effective host settings; explicit per-node overrides under Advanced; no silent fallback. |
| R03 | Tools use the active model while commands/UI can use another default. | Resolve the same conversation model, runtime, account and reasoning on all entry paths; persist actual attribution. |
| R04 | Main-agent restriction and current-session-ID ownership prevent legitimate other-agent/history use. | Host-authorized agent/session selection and recovery across reset; origin identity separate from current control authority. |
| R05 | Host failures lose structured codes and actionable context. | Stable error code, phase, node, model, retryability and recovery detail, without secrets. |
| R06 | Bindings accept fields their producer never returns; truthy evaluates an unused right operand. | Producer-aware validation and consistent typed predicates/missing-value behavior. |
| R07 | Failed saves can change memory while storage remains unchanged. | Transaction commits before success/state visibility; corruption/disk failure and conflict tests. |
| R08 | Publishing a different capability set can revoke an older parked run accidentally. | Immutable revision grants; disable prevents new starts; explicit revoke prevents future existing dispatch. |
| R09 | Identical intentional commands deduplicate. | Fresh identity for intentional invocation; stable explicit/transport IDs for retries; canonical input fingerprints. |
| R10 | One mutable definition combines draft, publication and activation. | Immutable versions; save draft without disabling publication; publish, compare, restore, archive and recover. Preserve legacy `enabled:false` meaning. |
| R11 | Whole-state JSON and shallow validation provide weak recovery. | Plugin-owned SQLite, serialized access, versioned schema, transactional migration/backup, locking and integrity checks. |
| R12 | Restart marks all running work uncertain with no committed-checkpoint continuation. | Attempt journal and checkpoint recovery; never automatically replay unknown effects; explicit retry/restart ancestry. |
| R13 | Two-run rejection and premature cancellation slot release. | Queue with configurable concurrency; retain physical execution accounting until cleanup; cancellation prevents downstream dispatch. |
| R14 | 20-loop and 50-run caps can reject work or evict useful history. | Pagination and configurable retention; protect active/parked/referenced/settling records; no implicit data deletion. |
| R15 | Small flat scalar input/output schemas and a 5-iteration maximum. | Version 2 contracts, zero inputs, nested JSON and safe traversal, configurable repeat/budgets; retain version 1 semantics. One internal node-contract registry covers validation, inputs, outputs, execution and editor configuration. |
| R16 | Large outputs are discarded/clipped without agent retrieval. | Persist complete outputs, paged/ref retrieval and previews; documented transport/storage budgets. |
| R17 | UI-only inspection, review and history; weak output schemas. | Shared typed operations with agent parity for every non-human-only operation; explicit authenticated human decisions only at review nodes. |
| R18 | No capability/preflight surface. | Distinguish configured, authorized, supported, available and unknown; diagnose before running where possible. |
| R19 | Editor lacks versions, undo/redo, duplication, search, layout and typed bindings. | Practical graphical authoring with version compare and those controls. |
| R20 | Unsaved edits can be lost, conflicts are awkward, and input values leak between selections. | Recoverable local drafts, unload guard, conflict reload/merge, input reset and optional-value controls. |
| R21 | History/results/queue/recovery are incomplete in the UI. | Full run browsing, output retrieval, cancellation/cleanup state, test unpublished drafts, recovery controls. |
| R22 | Fixed polling and no durable asynchronous completion delivery. | Scoped invalidation and authorized fetch; durable delivery dedupe through a legitimate requester-bound host capability. |
| R23 | Accessibility, theme and responsive behavior lack acceptance evidence. | Keyboard and screen-reader authoring paths, contrast/focus, light/dark and small-screen testing. |
| R24 | Individual-only local evidence, no deployment/upgrade/package CI. | Individual/team/customer isolation tests, macOS/Linux and declared host/Node compatibility, resource/soak/failure/upgrade tests. |
| R25 | Private POC package, no release governance or registry verification. | Public source/license/notices/contributor docs/CI, installable artifact, migration/rollback/uninstall docs, ClawHub dry run/publication and fresh registry install. |

## Advanced inference controls (R02/R03/R18)

Inference nodes have a collapsible **Advanced settings** category. Include every generation setting exposed by the selected OpenClaw runtime/provider: temperature, top_p, top_k, min_p, typical_p, frequency penalty, presence penalty, repetition penalty, seed, stop sequences, output-token limit and other declared provider options. Reasoning is selectable alongside the model. Preserve per-node agent and system-instruction configuration within the fresh, tool-free completion contract.

Store only explicit overrides. Unset means inherit host behavior, including when the effective numeric default is unknown. Zero is a valid explicit value and must survive all persistence and transmission paths. Allow reset of one setting or all settings. Model switches and imports preserve settings and surface compatibility problems rather than silently discarding values.

Typed capability descriptors provide type, range/enum, effective default where known, and supported/advisory/unsupported/unknown status. Unsupported explicit overrides fail preflight with a reason. Merely leaving unsupported controls unset must not block an otherwise usable model. Never label a setting enforced when the runtime only accepts it as a hint. Never mutate global provider configuration to implement a node override.

Expose the same definitions and controls to agents. Verify draft, publish, clone, import, export and restore round trips. Record requested, normalized and transmitted settings where observable, separately from applied settings. Assert actual transport parameters in tests; do not infer enforcement from a model's prose. On OpenClaw 2026.9.3, `llm.complete` publicly types temperature/maxTokens as advisory and reasoning as normalized; top_p and penalties are not present on that API despite support in other host surfaces. Track the exact SDK gap and minimum version required to close it.

## List 2: deferred expansion and mechanism validation

This list preserves the broader product direction. It does not authorize expansion implementation before 1.0 or make those milestones a condition of completing this goal. Basic nested JSON/output paging (X05), human and agent invocation (X18), manual waits/reviews (X19/X22), explicit uncertain-outcome recovery (X23), definition import/export (X27), and the 1.0 team/deployment requirements (X28) remain covered by the R requirements. Only their additional capabilities are deferred.

| ID | Capability family | Required behavior and combined proof |
|---|---|---|
| X01 | Main context | Structured shared context with versioned node input projections and explicit output patches. |
| X02 | Context policy | Each node chooses consume/omit/append/replace/merge; deterministic conflict rules and recorded provenance. |
| X03 | Context lifecycle | Retrieve/inject context, summarize/compact/reset at chosen steps, keep source artifacts and explain lossy operations. |
| X04 | Memory | Explicit memory read/write scopes and opt-in behavior using host authority; no hidden consolidation. |
| X05 | Rich data and artifacts | Nested schemas, arrays, binary/file references, large data paging and portable artifact retention. |
| X06 | Script nodes | Arbitrary executable pointers, argv/environment/cwd/stdin, stdout/stderr/exit handling, cancellation and process-tree cleanup under explicit workspace execution authority. |
| X07 | Tool and integration nodes | Host tools, MCP, HTTP, browser, files and databases through legitimate scoped adapters with clear side-effect contracts. |
| X08 | Full agent nodes | Per-node agent, role, workspace, tools, memory, model, reasoning and output contracts; use a real host agent loop. |
| X09 | Plans and goals | Real plan/goal operations where the host exposes them, not prompts pretending to manipulate native state. |
| X10 | Subagents | Spawn/wait/message/cancel/collect tasks with budget and identity propagation and inspectable child evidence. |
| X11 | General iteration | Arbitrary repeat bodies, for-each, while/until, break/continue and explicit finite execution budgets. |
| X12 | Branching | Switch and typed/missing-value conditions with validated exhaustive edges. |
| X13 | Parallelism | Parallel fork/join, race and quorum; cancellation, deterministic context merges and resource budgets. |
| X14 | Nested loops | Pinned subloop calls, parent-child provenance, shared budgets/cancellation and bounded recursion. |
| X15 | Time triggers | Cron/calendar/interval/time-zone/DST behavior, missed-run policy and restart recovery. |
| X16 | Event triggers | Events, webhooks, file changes and host hooks; authenticated payloads and durable dedupe/debounce. |
| X17 | Inference triggers | Model-decided triggering with structured decisions, attribution, budgets and self-trigger controls. |
| X18 | Conversation invocation | Both human and LLM can invoke loops and send signals from the active conversation. |
| X19 | Durable signals/waits | Correlated external signals, timers and human waits survive restart without lost or duplicate wakeups. |
| X20 | Evaluations | JSON Schema, deterministic checks, executable tests, model judges and reusable evidence records. |
| X21 | Conditional completion | Exit nodes require specific evidence/conditions; refinement routes feedback until success or explicit budget exhaustion. |
| X22 | Human interactions | Questions/forms, role or person assignment, deadlines and authenticated recorded decisions. |
| X23 | Failure handling | Retry/backoff/jitter, circuit breakers, explicit uncertain outcomes, finally and compensating actions. |
| X24 | Debugger | Breakpoints, single-step, checkpoint inspection and recorded-response replay without silently repeating effects. |
| X25 | Test and experiment workbench | Fixtures, property tests, multiple candidate variants and evaluation comparisons with reproducible evidence. |
| X26 | Live steering/version evolution | Deliberate amendments/migrations for future steps with complete ancestry; no silent mutation of pinned work. |
| X27 | Reuse and portability | Reusable components/templates, dependency pinning, package import/export and environment binding. |
| X28 | Operations and collaboration | Remote workers, shared authoring/conflicts, observability, resource/cost usage and deployment compatibility. |
| X29 | Optimization | Measured scheduling/model/context optimizations, caching with correct identity and repeatable quality comparisons. |

## Delivery packages and dependencies

The alpha already implements substantial parts of these packages. Continue from [verified status](DELIVERY_STATUS.md); do not restart completed work or count fixture evidence as live acceptance.

| Package | Deliverable and requirement mapping | Completion gate |
|---|---|---|
| P0 — Public plugin baseline | Publish the reviewed plugin-only tree and its existing history; MIT, notices, source metadata, contributor guide and CI (R25). Keep alpha status explicit. | Remote tree/history match the reviewed commit; source/package boundary audit and exact-commit CI pass. No claim of a stable release. |
| P1 — Upstream contract qualification | Refresh released SDK and existing issues/PRs; specify failing plugin-facing cases for SDK01–04 and SDK06. Reuse public model-only execution where it satisfies the semantics. | An issue-linked contract and test plan for every host gap, with existing PR ownership, residual coverage and required release tracked separately. |
| P2 — Finish plugin hardening | Complete R01–R16: defaults, structured errors, immutable versions, SQLite transactions, queue/cleanup/recovery, v2 graph contracts and full outputs. | Reproduced defects, failure boundaries, migration and workloads exceeding POC limits pass. No hidden model or authoring restrictions. |
| P3 — Upstream contributions and adoption | Contribute to existing PRs for cancellation/session state; implement uncovered, agreed issue scope in separate OpenClaw PRs. Finish sampling, account/session authority and delivery contracts without a private host fork (R02–R04, R12/R13/R18/R22). | Upstream tests, owner review and merge; released public exports; plugin adapter tests and real runtime evidence against that release. A merged PR alone is insufficient. |
| P4 — Complete 1.0 experience | Finish Advanced, effective agent/session/model/reasoning, versions, recovery, binding/editor tools, accessibility and UI/command/agent parity (R17–R23). | Equivalent authenticated lifecycle journeys through all three interfaces; requested settings verified at transport; human review remains explicit. |
| P5 — Qualify release candidate | Individual/team/separate-customer deployments, macOS/Linux, declared Node/OpenClaw combinations, resource/fault/soak/upgrade tests (R24 and all remaining acceptance). | All mandatory capabilities work through an ordinary external-plugin install on unmodified released OpenClaw. Tested version matrix and limitations are published. |
| P6 — Registry release | Versioned artifact, migration/deployment/capability/release docs, hashes, ClawHub validation/dry run, verified publisher upload and fresh registry installation (R25). | Public artifact is installable; fresh installations and migration pass on the published bytes; then mark 1.0 released and this goal complete. |

P0 and independent P2/P4 work can proceed while upstream contracts are reviewed. P3 adoption depends on P1 and actual upstream releases. P5/P6 cannot waive missing authority or settings contracts by narrowing the agreed 1.0 requirements silently. There is no promise that upstream will accept a particular design or release date.

### Work available before upstream contributions

Continue these plugin-owned packages against the pinned, unmodified OpenClaw release. They do not require an OpenClaw issue or PR to begin:

| Work | Next acceptance evidence |
|---|---|
| Transport storage failures (R05/R07/R16) | Safe errors and recovery through uploads, snapshots, UI, commands and tools; committed files survive partial writes, damaged records and actual filesystem exhaustion. This is the first independent hardening item. |
| Persistence, cleanup and resource hardening (R07/R11–R16) | Further crash/backup-restoration and bounded workload tests; reduce synchronous storage barriers; design explicit document/staging maintenance while preserving active work and referenced evidence. No automatic deletion until configured. |
| Editor and interface quality (R17/R19–R23) | Remaining keyboard and screen-reader journeys, responsive/browser coverage, conflict/draft recovery and complete-output journeys through the existing public adapters. Host identity and delivery gaps remain separately tracked. |
| Packaging and deployment preparation (R24/R25) | Repeatable ordinary plugin installation, upgrade/rollback and uninstall/reinstall; sustained resource tests and platform CI; current artifact documentation and ClawHub dry run. Full team/customer authority acceptance and stable publication still depend on the required released host contracts. |

Keep each result tied to its tested source/package. Fixture tests for unavailable host contracts are design evidence; they do not substitute for P3 adoption or final release acceptance.

### Upstream execution order

1. Qualify the current installed release and current upstream release without changing either personal profile. `disableTools` already exists in 2026.9.3 and 2026.9.4; test its semantics before proposing another implementation for #122172. Retain the current single-completion node semantics even if a host-owned durable runner is used internally.
2. Start from the existing cancellation PR #120140 and session-extension PR #127982, rather than opening duplicate implementations. Prepare plugin-facing cancellation, ownership, restart and negative-scope tests. Session-extension access is for a host session association, not a replacement for Loops' database or proof of session authorization.
3. Resolve SDK01/02 contracts: use #127561 for the exact sampling-alias defect; use #90193 only for its agreed transport scope. Full per-call sampling/capability forwarding and account-bound invocation remain explicit residual work. Contribute focused generic SDK tests and implementation after the owner contract is settled.
4. Resolve SDK03/04 with the existing identity and delivery owners. #115902's accepted approval-attribution work is only partial coverage; #145021 adds delivery cancellation, not durable delivery authority. Specify the missing session-access/reset and request-retention cases separately. Do not describe those issues as complete solutions for Loops.
5. Integrate only released supported APIs, raise the host version explicitly, and repeat plugin acceptance. Track issue, PR, merge SHA, first containing release, package version/hash and Loops consumer commit for each dependency. Keep source inspection, fixture tests and real runtime receipts distinct.

### Defaults and public contracts

Defaults remain host-inherited model, generation settings and active timeout; Repeat 3; node budget 1,000; local inference concurrency 1 on the 16 GB Mac; queued extra work; no retention deletion until configured; complete persisted results with references/pagination. Operator-configurable transport, storage and run budgets replace small POC constants.

Use explicit schemas for Definition, Advanced overrides/capabilities, Publication, Run/Attempt/Checkpoint, OutputReference and Error. Separate origin attribution, current control authority and pinned execution settings. Pin revision, execution-contract version and resolved settings at admission, and recheck current host permissions before dispatch, recovery and private reads. Keep existing `loops_*` names as compatibility adapters over one backend contract.

### After 1.0, under a subsequent goal

The dependency order remains context/data (X01–X05), scripts/tools/agents (X06–X10), control flow/subloops (X11–X14), triggers/signals (X15–X19), evaluation/recovery (X20–X23), and authoring/operations (X24–X29). Each later milestone must include semantics, public API, UI, persistence and a combined workflow. None is included in P0–P6 beyond the explicit 1.0 subsets above.

## Storage migration and rollback

Validate legacy JSON before modification. Retain an exact backup, then import in one transaction, preserving IDs/revisions/timestamps and known origin. Do not invent missing identity. Verify counts and representative content before switching stores. Existing runs retain their v1 execution contract. Future revisions use v2 deliberately. Version restores create new revisions. Archive/delete preserve referenced history through tombstones. Rollback restores a matched application/database pair; never run an older application against a newer unsupported database schema.

## Acceptance and evidence

Track every R ID in `DELIVERY_STATUS.md` with evidence and remaining work. Keep all X IDs explicitly deferred, with their 1.0 overlaps mapped above. Automated deterministic fakes prove mechanics; live host/UI/transport tests prove integration. Keep those claims distinct.

- Fault regressions: provider/account/model mismatch, zero/inherited/invalid/advisory Advanced settings, binding producer errors, unused operands, failed storage commits, stale saves, pinned revisions and duplicate admission.
- Durability: queue concurrency, cancel/timeout physical cleanup, process restart at every transition, uncertain side effects, disk-full/corruption/lock contention, backup restore and upgrade rollback.
- Limits: more than 20 loops and 50 runs, complete large outputs, configured budgets, pagination and protected retention.
- Journeys: UI and agent create/read/edit/enable/disable/draft/publish/run/inspect/output/recover/archive/delete; direct commands; explicit human approval cannot be impersonated by an agent.
- Deployment: individual, shared team with distinct host roles, two isolated customers, declared OpenClaw/Node releases, macOS/Linux, repeatable installation/uninstall/reinstall.
- Release: source hygiene, exact artifact hash, CI gates, ClawHub dry run and publication under a verified owner, fresh registry installation and smoke test.
- Combined 1.0 workflow: an agent authors/enables/invokes a loop, the user edits a draft while its pinned run continues, inference/condition/Repeat operate with inherited and overridden settings, Wait and Human review survive restart, and the result is completely retrieved with one authorized completion notification. Exercise rejection, cancellation, revocation and uncertain-outcome recovery as companion paths.

Deferred combined workflows remain scheduled research with retrieval/subagents, iterative development with scripts/tests and evidence-gated exit, external signals across restart, richer collaborative review and agent-authored loop improvement. Every later capability must participate before that later milestone is complete; these workflows are not 1.0 release gates.

## Goal completion

Complete this goal only when P0–P6 and R01–R25 pass, the required host contracts are available in declared released OpenClaw versions, and the exact public 1.0 package passes fresh installation/migration. Keep source publication, upstream PR submission/merge, local alpha acceptance and a registry release as separate states. The owner has authorized GitHub publication and pushing the reviewed plugin history; there is no remaining request for that same authorization.

No estimated date or unverified SDK availability is an acceptance substitute. Record genuine upstream or publication blockers explicitly while continuing independent work.
