# Targeted public SDK requirements

Baseline: OpenClaw 2026.9.3. These are integration dependencies for the accepted scope, not submitted or merged upstream changes. Loops does not import private implementations inspected for diagnosis.

| ID | Released gap | Proposed public addition | Acceptance |
|---|---|---|---|
| SDK01 | `LlmCompleteCommonParams` omits topP, penalties, seed, stops and provider extensions. Temperature/maxTokens are advisory. | Typed parameter-capability discovery and per-call generation overrides, with support and normalization metadata from the runtime owner. | Actual transport tests for inheritance, zero, invalid/unsupported/advisory values, Ollama greedy normalization and native Codex behavior; no global config writes. |
| SDK02 | Commands have bound completion; tool/session-action contexts lack an equivalent account/runtime-bound execution handle. | Invocation-bound model, reasoning, runtime and credential owner, with explicit authorized overrides. | Two accounts for one provider remain distinct across UI/tools/commands/waits/retries; no owner-credential fallback. |
| SDK03 | Session-action clients expose connection ID and broad scopes, not stable principal and target-session authorization. Session IDs change on reset. | Public authorization for read/control/authoring and history generations, with principal identity and delegated-agent restrictions. | Owner/member/read-only/other-session/team-role/reset/reassignment matrix; independent-customer isolation. |
| SDK04 | Delayed delivery needs legitimately retained requester-bound authority; several wake/delivery helpers are trusted-plugin-only. | Durable destination-bound receipt registration and later delivery redemption with dedupe and revocation. | Completion after the initiating request ends and after restart; no duplicate or cross-session delivery. |
| SDK05 | Native plans/goals, compaction, core-tool execution and subagent wake semantics vary across external-plugin surfaces. | Narrow runtime-owned operations preserving permission, cancellation, budgets and native task ownership. | Actual native plans/goals/subagents/tools/compaction with failure/restart tests; no prompts pretending to perform native operations. |

Define adapter contracts and tests in Loops, contribute narrow corresponding SDK changes upstream, then raise the minimum host version only when a released SDK supplies the necessary contract. Do not label a local fork supported OpenClaw or use operator credentials to bypass a trusted-plugin restriction.

References: [models](https://docs.openclaw.ai/plugins/sdk-runtime/models), [background work](https://docs.openclaw.ai/plugins/sdk-runtime/background-work), [host hooks](https://docs.openclaw.ai/plugins/sdk-overview/host-hooks), [state/system](https://docs.openclaw.ai/plugins/sdk-runtime/state-and-system), [multi-user](https://docs.openclaw.ai/concepts/multi-user), [trust model](https://docs.openclaw.ai/gateway/security/trust-model).
