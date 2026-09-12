# Loops delivery plan

Accepted scope, September 11, 2026. This plan supersedes the original POC's product ceilings where the user explicitly expanded them. The original handoff remains historical evidence. The plugin stays external to OpenClaw; EmbodySense and the personal assistant profile remain outside this project.

## Release sequence and boundaries

Harden the existing palette for 1.0, then deliver the expansion milestones below. The active implementation goal covers **both** stages. Each requirement needs implementation and verification; a passing build alone is not completion.

Support individual use, a shared team, and independent hosted customers. Use OpenClaw's identity and policy. Independent customers require separate Gateways, credentials, state and workspaces. Deliver the plugin, deployment guidance and validation for those scenarios, not a hosting business's signup, provisioning, billing or operations service.

Distribute as public open-source software, primarily through ClawHub. Preserve the plugin ID `loops-poc` and existing state identity through migration. Keep the npm/package display name separate from storage identity. Use supported public plugin APIs. Where the released SDK lacks necessary authority, settings or execution contracts, prepare targeted upstream additions; do not import private host internals or impersonate a trusted built-in plugin.

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
| R15 | Small flat scalar input/output schemas and a 5-iteration maximum. | Version 2 contracts, zero inputs, nested JSON and safe traversal, configurable repeat/budgets; retain version 1 semantics. |
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

Inference nodes have a collapsible **Advanced** category. Include every generation setting exposed by the selected OpenClaw runtime/provider: temperature, top_p, top_k, min_p, typical_p, frequency penalty, presence penalty, repetition penalty, seed, stop sequences, output-token limit and other declared provider options. Reasoning is selectable alongside the model.

Store only explicit overrides. Unset means inherit host behavior, including when the effective numeric default is unknown. Zero is a valid explicit value and must survive all persistence and transmission paths. Allow reset of one setting or all settings. Model switches and imports preserve settings and surface compatibility problems rather than silently discarding values.

Typed capability descriptors provide type, range/enum, effective default where known, and supported/advisory/unsupported/unknown status. Unsupported explicit overrides fail preflight with a reason. Merely leaving unsupported controls unset must not block an otherwise usable model. Never label a setting enforced when the runtime only accepts it as a hint. Never mutate global provider configuration to implement a node override.

Expose the same definitions and controls to agents. Verify draft, publish, clone, import, export and restore round trips. Record requested, normalized and transmitted settings where observable, separately from applied settings. Assert actual transport parameters in tests; do not infer enforcement from a model's prose. On OpenClaw 2026.9.3, `llm.complete` publicly types temperature/maxTokens as advisory and reasoning as normalized; top_p and penalties are not present on that API despite support in other host surfaces. Track the exact SDK gap and minimum version required to close it.

## List 2: expansion and mechanism validation

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

## Delivery milestones

1. **Repair and contracts.** Capture baseline; reproduce R01–R09. Fix dev policies and inference defaults first. Build capability/preflight and shared operation contracts. Validate real commands, agent tool invocation and the user's feature-matrix loop on the isolated profiles.
2. **Durable 1.0 execution.** Add SQLite worker/schema, migration, immutable revisions, publication, queue, attempt journals, output references and restart recovery. Introduce schema version 2 while preserving version 1 execution semantics. Default total node budget 1,000, repeat 3, host-inherited inference timeout unless an explicit loop budget is set, local inference concurrency 1 on the 16 GB Mac, no automatic retention deletion.
3. **Complete 1.0 authoring and delivery.** Implement UI/tool parity, Advanced, versions, editable drafts and accessibility. Request-bound host authority/model/account/cancellation/delivery must be proven; upstream SDK contributions are dependencies when needed. Run the full scenario/package/upgrade/resource matrix. Publish only the verified artifact, then verify a clean registry install.
4. **Context and data (X01–X05).** Add main context contracts, projection/patch policies, retrieval, memory and compaction/reset.
5. **Execution adapters (X06–X10).** Scripts/integrations/full agents/plans/goals/subagents, preserving host permissions and side-effect accounting.
6. **Control flow (X11–X14).** General iteration, branching, parallel joins and nested pinned loops.
7. **Triggers and interaction (X15–X19).** Schedules/events/hooks/inference/conversation invocation and durable correlated signals.
8. **Evaluation and recovery (X20–X23).** Validators/judges/evidence exits, human forms and failure policies.
9. **Workbench and operations (X24–X29).** Debug/replay/fixtures/experiments/steering/reuse/remote workers/collaboration/optimization.

## Storage migration and rollback

Validate legacy JSON before modification. Retain an exact backup, then import in one transaction, preserving IDs/revisions/timestamps and known origin. Do not invent missing identity. Verify counts and representative content before switching stores. Existing runs retain their v1 execution contract. Future revisions use v2 deliberately. Version restores create new revisions. Archive/delete preserve referenced history through tombstones. Rollback restores a matched application/database pair; never run an older application against a newer unsupported database schema.

## Acceptance and evidence

Track every R/X ID in `DELIVERY_STATUS.md` with evidence and remaining work. Automated deterministic fakes prove mechanics; live host/UI/transport tests prove integration. Keep those claims distinct.

- Fault regressions: provider/account/model mismatch, zero/inherited/invalid/advisory Advanced settings, binding producer errors, unused operands, failed storage commits, stale saves, pinned revisions and duplicate admission.
- Durability: queue concurrency, cancel/timeout physical cleanup, process restart at every transition, uncertain side effects, disk-full/corruption/lock contention, backup restore and upgrade rollback.
- Limits: more than 20 loops and 50 runs, complete large outputs, configured budgets, pagination and protected retention.
- Journeys: UI and agent create/read/edit/enable/disable/draft/publish/run/inspect/output/recover/archive/delete; direct commands; explicit human approval cannot be impersonated by an agent.
- Deployment: individual, shared team with distinct host roles, two isolated customers, declared OpenClaw/Node releases, macOS/Linux, repeatable installation/uninstall/reinstall.
- Release: source hygiene, exact artifact hash, CI gates, ClawHub dry run and publication under a verified owner, fresh registry installation and smoke test.
- Combined expansion workflows: scheduled research with retrieval/subagents; iterative development with real scripts/tests and evidence-gated exit; external signal waits across restart; shared human review; agent authors/enables/invokes/diagnoses/revises a loop. Every X capability must be used in at least one combined real workflow.

No estimated date or unverified SDK availability is an acceptance substitute. Record genuine upstream or publication blockers explicitly while continuing independent work.
