# Capabilities and current release boundaries

The development alpha uses **OpenClaw 2026.9.3** and **Node 24.16.0**. It is an external feature plugin with the stable runtime/storage ID `loops-poc`. Runtime imports use public `openclaw/plugin-sdk/*` exports. This package is not a published or accepted 1.0 release. The old capability record is preserved in `CAPABILITIES-0.3.md` for historical reference.

| Surface | Current behavior |
|---|---|
| Native UI | React Flow graph, node/edge inspector, agent/session selection, examples, JSON import/export, search, undo/redo, duplication, auto layout and binding picker. |
| Authoring | Enabled creation by default; explicit disabled drafts; draft saving separate from publication; immutable versions, publish, restore, archive/delete/recover operations. |
| Execution | One engine for command, tools and UI; sequential execution with a configurable queue; pinned definition/model/reasoning; manual waits and authenticated admin review. |
| Data | v2 zero-input and nested JSON contracts, safe traversal, typed equality, explicit budgets, full persisted outputs and paged output/history tools. |
| Inference | Public isolated-agent-runtime completion; model/agent/reasoning/Advanced overrides; unset values inherit. Actual provider/model and requested/transmitted settings are recorded. Applied values remain unknown unless observable. |
| Persistence | Plugin-owned SQLite on a serialized worker; immutable revisions and admission/attempt/output/event records; transactional commits, integrity checks, process lock and verified legacy JSON migration. |
| Recovery | Durable wait/review; explicit checkpoint/retry-node/restart with ancestry. Unknown effects require an explicit choice and are never automatically replayed. |
| Agent parity | 31 tools expose discovery, authoring, publication, versions, archive/recovery, execution/test/retry/status/history/full inspection/output. Explicit human review uses authenticated UI or human command authority. |
| Commands | `/loops <operation> <JSON object>` exposes all 33 shared operations, including upload and document paging. `help` lists them; `help <operation>` derives arguments from the shared schema. Existing execution shortcuts remain available. The host's command write gate and explicit Human review authority apply. |

Inference and the read-only configured-model Action are host-backed. The remaining palette is deterministic plugin logic. Repeat still has a fixed Inference/Condition body. Scripts, subagents, schedules, parallel branches and nested loops are accepted expansion milestones, not implemented capabilities yet.

## Advanced inference settings

Advanced is available on standalone and Repeat-body inference nodes. Temperature and output tokens are **advisory** on the current public SDK. Reasoning is normalized by OpenClaw. Portable fields for top_p, top_k, min_p, typical_p, frequency/presence/repetition penalty, seed and stop sequences are preserved by the definition contract but displayed as unsupported through the current isolated completion API. An unset unsupported field does not prevent execution; an explicit override fails preflight with the reason. Zero is retained, never treated as inheritance.

Some provider/streaming surfaces support these options, but `LlmCompleteCommonParams` in 2026.9.3 does not expose them. Loops does not mutate global provider settings, switch runtimes, or claim requested values were applied. See [upstream requirements](UPSTREAM_REQUIREMENTS.md).

The old forced temperature 0.2, maxTokens 512 and reasoning off are removed. Profile repair backs up and removes only exact single-model policies emitted by the old scaffolders; custom policy is preserved. OpenClaw still enforces model/account authorization.

## Authority and remaining work

The main-agent-only check is removed. Caller identity comes from trusted host context. Current run inspection/control still requires the exact originating agent, session key and session ID. Conversation-reset recovery, team role authorization and per-person account selection need stronger public host contracts. This alpha does not claim multi-user readiness. Independent customers require isolated Gateways.

Disable blocks new runs. Explicit revoke blocks future dispatch in existing runs. Publishing a different capability set no longer accidentally revokes an older pinned run. UI authoring requires operator write/admin; Review requires admin. Agent lifecycle operations can publish and enable but cannot impersonate a human decision.

Cancellation/timeout stops downstream dispatch while a host call ignoring cancellation retains its physical slot until settlement. No exactly-once external-effect claim is made. Restart currently requires authenticated recovery to continue unparked work; automatic wake and delayed delivery remain open. Invalidation events contain no run IDs, inputs or outputs; clients fetch authorized state separately.

## Budgets and compatibility

New UI definitions use v2 with default 1,000 node executions and 1 MiB per-node output. Repeat defaults to 3 and can increase within the total budget. Omitted v2 timeouts inherit the host; explicit loop timeouts count elapsed active execution across steps and resumes. Concurrency defaults to one for the 16 GB local-model machine; `plugins.entries.loops-poc.config.maxConcurrentRuns` adjusts it. Additional starts/continuations queue.

There is no 20-loop or 50-run eviction. Explicit retention management is still pending. The service loads records into memory and uses a synchronous commit barrier around its worker; asynchronous/lazy storage and scale/soak validation remain open. Default v2 storage/execution budgets are 4 MiB definitions and 1 MiB inputs/prompts, configurable under plugin `config.budgets`. Host feature messages independently allow 256 KiB, 64K UTF-16 string units, depth 32 and 4,096 JSON values. Chunked uploads and immutable result documents bridge those limits without reducing graph or output budgets. [Transport details](TRANSPORT.md). Version 1 retains legacy binding/comparison/flat-JSON and transport/evidence behavior.

JSON migration retains the original file and a timestamped backup. Rollback requires a matching application/store pair. Native UI has trusted host-origin authority; Shadow DOM isolates styles, not security.

See [plan](DELIVERY_PLAN.md), [verification](VERIFICATION.md), and [status](DELIVERY_STATUS.md). Primary sources: [model SDK](https://docs.openclaw.ai/plugins/sdk-runtime/models), [feature plugins](https://docs.openclaw.ai/plugins/feature-plugins), [trust model](https://docs.openclaw.ai/gateway/security/trust-model), [Ollama parameters](https://docs.openclaw.ai/providers/ollama/advanced).
