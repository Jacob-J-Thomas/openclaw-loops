# OpenClaw Loops: standalone 1.0 delivery plan

Owner scope revision, September 21, 2026. This contract supersedes earlier requirements to extend OpenClaw before releasing Loops. Deliver a practical, public, independently installable plugin using supported released OpenClaw APIs. **Optional host enhancements are post-1.0 work. No OpenClaw issues, PRs, comments or patches are authorized in this delivery.**

Follow [AIDLC](AIDLC.md): one scoped Bolt per ready PR to main, bounded independent review, verified merge, separate parent acceptance and post-landing QA. Preserve completed implementation, evidence, data and history. Deferred work stays visible without being counted as a release blocker or as completed functionality.

## 1.0 product contract

Ship Input, Inference, configured-model Action, Condition, Repeat, manual Wait, Human review, Return and Fail. Action reads configured-model metadata. Inference performs one fresh, tool-free completion; Repeat retains its Inference/Condition body. Full agent control includes authoring enabled loops or drafts, editing, publication, activation, invocation, inspection and deletion. Only an explicitly authored Human review requires a human decision.

Individuals can choose an inference model or use a documented configured default. Use the same explicit model through UI, commands and tools where host policy permits it. Automatic inheritance of the invoking conversation's exact model/account/runtime binding is optional; do not silently promise it or copy credentials to simulate it. The host owns authorization and account selection. Keep forced temperature 0.2, 512-token limits, reasoning-off and generated model allowlists removed.

The 1.0 authority boundary is the host-authorized current agent/conversation and its retained generation. Preserve existing supported reset/restart behavior, waits, explicit recovery, complete outputs and library operations. Independent customers use separate Gateways, state, credentials and workspaces. A shared trusted Gateway has a shared library and its existing operator scopes; per-person team permissions and newly selected cross-session inspection/recovery are post-1.0 when they require host changes.

Persist completion state and expose results through the inspector, history, commands and tools. Use authorized live invalidation followed by scoped reads. A completion notification is an optional convenience: missing durable delivery authority or an outgoing-notification AbortSignal does not prevent a run completing or its result being retrieved. Do not invent a destination or retry an uncertain send automatically.

Keep conservative cancellation: prevent downstream dispatch, propagate supported cancellation, retain executing/settling capacity until the host promise settles, and require explicit recovery for uncertain work. Remote-provider physical-stop attestation and adoption of a durable host runner are future enhancements; local promise settlement is not proof that remote work stopped.

Release under MIT through ClawHub and public plugin-only source. Preserve runtime/storage ID `loops-poc`, package identity and migration history. No direct provider clients, OpenClaw patches/private internals, copied profiles, EmbodySense code or hosting-business services belong in the repository/package. See [release boundaries](RELEASE_SCOPE.md).

## Requirement disposition

All 25 original findings remain accounted for. The 1.0 column is the acceptance contract; the final column explicitly separates optional expansion.

| ID | Required for 1.0 | Deferred or qualified boundary |
|---|---|---|
| R01 | Back up and repair recognizable generated model policies; preserve operator configuration and authorized models. | Operator policy remains authoritative. |
| R02 | Omit forced generation/reasoning defaults; preserve existing saved overrides and valid explicit zero. | Full Advanced controls, descriptors and provider enforcement qualification are optional/post-1.0. |
| R03 | Usable explicit model selection or configured default; accurate requested/returned model attribution through UI, commands and tools. | Automatic conversation model/account/runtime inheritance and two-account parity are post-1.0. |
| R04 | Supported current-agent/current-session authoring, reads and recovery; preserve origin separately from control. | New cross-session/reassignment and independent-team authorization need future host contracts. |
| R05 | Safe structured error code, phase, node, model, retryability and recovery detail. | No claim of every provider's error or effective-account attribution. |
| R06 | Producer-aware bindings, typed predicates and explicit missing-value behavior. | Generalized control flow remains future work. |
| R07 | Commit before reporting success; transactional consistency and storage/conflict fault coverage. | Process-kill evidence is not physical power-loss evidence. |
| R08 | Immutable revision grants; disable new starts; revoke future dispatch explicitly. | Ordinary edits must not revoke older pinned runs. |
| R09 | Separate intentional invocation from stable retry identity; preserve canonical fingerprints. | No exactly-once external-effect guarantee. |
| R10 | Draft, publish, enable/disable, versions, compare, restore, archive/delete/recover; preserve legacy disabled semantics. | Wider sharing authority remains deferred. |
| R11 | Plugin-owned SQLite worker, migration, backups, locking and integrity checks. | No shared/network database or custom host state replacement. |
| R12 | Persist attempts/checkpoints; preserve waits/reviews and explicit retry/restart ancestry. | No automatic replay of uncertain effects or mandatory durable host-runner adoption. |
| R13 | Queue with configurable concurrency; honest cleanup accounting; cancel downstream work. | Remote-provider physical settlement receipts remain optional future host work. |
| R14 | Paginated history and configurable retention protecting active/parked/referenced/settling records. | No implicit history deletion. |
| R15 | V2 JSON/nested bindings, zero-input loops, configurable Repeat/budgets and node contracts; retain v1 compatibility. | New node families and general Repeat bodies remain deferred. |
| R16 | Complete persisted outputs, references/paging and documented configurable transport/storage budgets. | Host context capacity still bounds any single conversation. |
| R17 | One typed backend for UI, commands and agent lifecycle operations; authenticated human review. | Agents cannot impersonate an explicitly required human decision. |
| R18 | Useful configured/authorized/supported/available/unknown diagnostics; do not block models for unset optional controls. | Full runtime parameter discovery and effective-account attestation are post-1.0. |
| R19 | Versions, undo/redo, duplication, search, layout and typed binding authoring. | Advanced workbench remains future scope. |
| R20 | Recoverable edits, navigation guard, conflict handling and input reset between selections. | Retain invalid drafts for correction. |
| R21 | Run history, complete outputs, queue/cancel status, draft tests and authorized recovery controls. | Recovery into a different session is not promised. |
| R22 | Scoped live invalidation, authorized result retrieval and persisted completion/delivery state. | Delayed/restart notifications, outgoing-send cancellation and cross-session delivery are optional/post-1.0. |
| R23 | Practical keyboard/screen-reader authoring, focus/contrast, themes and responsive qualification. | Record exact observed coverage; do not infer spoken behavior from fixture labels. |
| R24 | Individual and separate-Gateway deployments; real model journeys, macOS/Linux, declared Node/host versions, fault/resource/lifecycle qualification. | Distinct shared-team principals and unavailable durable delivery/remote settlement are not 1.0 gates. |
| R25 | Public source/license/notices/CI, exact installable artifact, deployment/migration/rollback/uninstall docs, ClawHub publication and fresh registry verification. | No stable-release claim before the actual publication and install checks pass. |

## Optional Advanced settings

Existing Inference/Repeat Advanced editing and saved values remain compatible. Unset means inherit host/provider behavior, including an unspecified default. Preserve explicit zero, individual/section reset, import/export/version round trips and incompatibility diagnostics. Never erase overrides on a model switch or change shared configuration for one invocation.

The pinned OpenClaw 2026.9.6 isolated completion contract exposes temperature/output-token hints and normalized reasoning. Other stored fields may be unsupported. Unset unsupported controls must not block an otherwise usable model; incompatible explicit overrides need a clear reason and reset path. Requested or transmitted-to-host values are not proof of provider enforcement.

Full top-p/top-k/min-p/typical-p, penalty, seed/stop forwarding, complete dynamic descriptors and actual applied-value/account attribution are post-1.0. No upstream contribution or extra provider control is needed just to complete this release.

## Post-1.0 expansion inventory

The existing 29 expansion families remain preserved. Conversation invocation, nested JSON/output paging, manual wait/review, explicit uncertain recovery, import/export and ordinary authoring already have the 1.0 subsets above. New families require a later goal and combined acceptance.

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

## Delivery packages

| Package | Current deliverable | Completion gate |
|---|---|---|
| P0 | Public plugin source, preserved history, MIT/notices/contributor guide and CI. | Exact reviewed source/package boundary; no host code or private state. |
| P1 | Qualify the pinned public SDK and document usable fallbacks and capability limits. | Distinguish 1.0 behavior from optional SDK01–04/06 enhancements; no upstream posting. |
| P2 | Finish plugin-owned execution/data/default/error hardening (R01–R16). | Meaningful defect, storage, migration, queue and beyond-POC workload checks. |
| P3 | Supported-API integration and explicit-model/default qualification. | Actual UI/command/tool behavior on unmodified released OpenClaw; no missing optional API gate. |
| P4 | Complete authoring, inspection, recovery, parity and accessibility (R17–R23). | Practical authenticated lifecycle journeys; existing optional controls remain compatible. |
| P5 | Qualify the final candidate (R24). | Exact source/package CI, real runtime/browser, faults, isolated deployment and lifecycle evidence. |
| P6 | Publish and verify registry release (R25). | Verified publisher, exact artifact/hashes, ClawHub validation/dry run, publication and fresh installation/migration. |

Proceed through all independent plugin work. For a failing requirement, first test a supported, practical alternative. A blocker must prevent an in-scope 1.0 outcome after those alternatives, with concrete evidence and a named next action. An optional enhancement, unknown attribution, theoretical guarantee or unanswered upstream proposal is not such a blocker.

Defaults: explicit node model when selected, otherwise the documented effective configured model; generation controls/active timeout inherit unless overridden; Repeat 3; node budget 1,000; local concurrency 1 on the 16 GB Mac; extra work queues; no retention deletion until configured; complete outputs with references/pagination. Do not infer that a configured model is currently available or permitted.

## Migration and acceptance

Validate/back up legacy JSON and transactionally preserve IDs, revisions, timestamps and known attribution. Keep the original file. Retain legacy execution semantics for existing runs. Rollback restores a matching stopped application/profile/database/document backup; never let an older plugin open an incompatible store or rewrite identity to bypass authorization.

Use exact source, host, package and evidence identities. Reuse unchanged evidence with an explicit equivalence argument. Deterministic fixtures prove mechanics; real host/browser/transport checks prove their exercised paths. Do not repeatedly rerun unchanged broad suites or exhausted host-context experiments.

The combined 1.0 journey covers an agent authoring/enabling/invoking a loop, explicit model/default execution, concurrent draft editing with pinned publication, the nine-node palette, restart-preserved Wait/Human review, and complete stored-result retrieval. Companion paths cover rejection, cancellation, revocation, conflict and uncertain recovery. A push notification is not required to retrieve or accept the result.

After all implementation PRs merge, finish adversarial QA, fix admitted plugin defects, and complete P6 on the exact final bytes. Publish tested limitations, including supported session scope and host context limits. Source publication, local acceptance and verified stable registry release remain separate states.

## Upstream hold

SDK01–04/06 expansions and X01–X29/SDK05 remain visible in the future roadmap and [SDK register](UPSTREAM_REQUIREMENTS.md). No OpenClaw PR, issue, comment, patch or maintainer coordination is part of the current goal. Adopt an already released supported API only when useful, scoped and tested. The owner will decide when to review any future upstream work.
