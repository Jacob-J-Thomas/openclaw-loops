# Supported host APIs and deferred enhancements

Owner scope revision, September 21, 2026. Loops 1.0 uses the public APIs of its tested released host. **No upstream OpenClaw issues, PRs, comments or patches are part of this goal.** Earlier contribution directions are superseded. This file retains named contract limits and historical qualification; it is not an active upstream work queue.

## Current release decisions

| ID | 1.0 approach | Post-1.0 enhancement |
|---|---|---|
| SDK01 | Omit generation settings by default; preserve existing optional Advanced values, honest advisory/unsupported states and reset paths. | Complete per-call sampling forwarding, dynamic capabilities and applied-setting attribution. |
| SDK02 | Explicitly select a model or use the documented configured default; let OpenClaw authorize/select credentials. Record requested and observable returned identity without claiming effective account parity. | Automatic invoking-conversation model/runtime/account inheritance on every entry path and two-account attestation. |
| SDK03 | Use supported host current-agent/session scope and its retained generation; separate Gateways for independent customers. Preserve existing supported resets and recovery. | Independent shared-team principals, newly selected target authorization and cross-session/reassignment recovery. |
| SDK04 | Persist completion/results and provide authorized UI/command/tool retrieval plus live invalidation. Notifications are optional. | Delayed/restart destination authority, outgoing-notification AbortSignal and broader durable delivery. |
| SDK06 | Keep one fresh isolated completion, supported cancellation, downstream stop, host-promise cleanup accounting and explicit uncertain recovery. | Durable host-runner adoption and remote-provider physical settlement receipts. |
| SDK05 | No full-agent or new node-family implementation in 1.0. | Tools, plans/goals, managed context, subagents and broad integrations. |

A missing enhancement in this table does not block 1.0. Do not invent authority, suppress an actual in-scope defect, add a direct provider client, or remove saved settings to make a test pass. Test a practical public-API path first and record any genuine remaining limitation.

## Historical qualification

The following receipts describe the stated host/source versions. They remain useful evidence, not claims of current upstream issue state, comprehensive provider support or a stable registry release.

## Verified baseline

- Current pinned peer: **OpenClaw 2026.9.5**. [Bolt #186 acceptance](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/186#issuecomment-5753434803) records the merged alpha.18 source, ordinary local upgrade, real Codex/Ollama routes, four-platform lifecycle/workload checks and final archive identity. Alpha.19 retains that peer; changed runtime bytes require their own qualification.
- Published upstream release under qualification: [v2026.9.5](https://github.com/openclaw/openclaw/releases/tag/v2026.9.5), published September 19, commit `ec9c1a13db8938e5a3eaa51fca2e981cde2395a9`; npm integrity is `sha512-TCO/ImVLh5HkF4tdfo7iriIa7kT6iYkIr/jR5ZOkePGFGhUx5Oe7DE716Y1DzzG2teRAVDdCjgJDu1A24Yta7w==`.
- The released [2026.9.5 runtime contract](https://github.com/openclaw/openclaw/blob/ec9c1a13db8938e5a3eaa51fca2e981cde2395a9/src/plugins/runtime/types.ts) is unchanged from 2026.9.4 for `subagent`: it exposes `run({disableTools:true})`, idempotency, wait/inspection and `completionDelivery:"current-requester"`, but not `subagent.abortSession`. Declaration presence alone does not establish availability from every external-plugin invocation context or durable requester authority.
- The [2026.9.5 completion contract](https://github.com/openclaw/openclaw/blob/ec9c1a13db8938e5a3eaa51fca2e981cde2395a9/src/plugins/runtime/types-core.ts) still exposes only advisory temperature/maxTokens and normalized reasoning as isolated generation controls. Results add optional `responseModel` and `stopReason`; `responseFormat` and `requiredAuthMode` are direct-provider-only and isolated completion rejects them. Isolated completion still accepts a fresh single user prompt and an optional host-policy-gated `authProfileId`. A caller-provided account ID is not a host-attested account binding.

Issue state, linked PR state, source behavior and first containing release are separate facts. Recheck them at contribution and adoption time. An open issue may describe already-landed behavior; a related PR may fix only part of the requirement.

## Released completion failure causes

[OpenClaw PR #147901](https://github.com/openclaw/openclaw/pull/147901), merged as `540476db48c9afe200a05f2917bc205d9550cdc3`, retains nonterminal provider failure metadata in nested error causes in released 2026.9.5. The historical information-loss evidence in [Finding #134](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/134) must not be generalized to this release. [Bolt #192](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/192) repairs Loops' remaining classification precedence: a recognized nested service failure takes priority over generic output rejection. No duplicate upstream implementation is required for that repaired propagation path.

[Installed-host qualification](VERIFICATION.md#alpha19-wrapped-provider-failure-diagnostics) compares alpha.18 and alpha.19 against the same released host, exercises controlled success/authentication/model/rate/context/service/tool-output responses, and records the real local Ollama missing-model result separately. It proves those safe error categories and downstream failure boundaries. It does not establish effective account identity, complete settings attribution, physical cancellation or diagnostics from every runtime/provider; the broader optional SDK enhancements below remain deferred.

## SDK01 consumer qualification — September 20, 2026

The [compile-only consumer](https://github.com/Jacob-J-Thomas/openclaw-loops/blob/main/test/contracts/sdk01-consumer.ts) imports
`OpenClawPluginApi` from the supported `openclaw/plugin-sdk/core` export. The
normal `npm run typecheck` gate checks inherited and explicit-override requests
against the pinned **2026.9.5** peer. It makes no runtime or provider call.
Its key assertions deliberately require renewed qualification when the peer
changes; an absent member assertion describes that named interface only.

| Public contract | Available behavior | Qualification limit |
|---|---|---|
| `runtime.llm.complete` isolated request | One fresh user prompt; optional model, temperature, output-token limit, reasoning and cancellation signal. Omitting generation overrides inherits host behavior. Explicit temperature `0` typechecks. | Temperature and `maxTokens` are documented advisory hints. Type acceptance does not establish model validity, normalization or provider enforcement. Loops still requires a positive output-token limit. |
| Direct-provider-only controls | `responseFormat` and `requiredAuthMode:"oauth"` typecheck only on the direct request branch. | Loops does not adopt direct-provider completion. The isolated request branch excludes these keys and the released runtime rejects them before dispatch. |
| Additional sampling overrides | The requested top-p/top-k/min-p/typical-p, penalties, seed and stop keys are absent from this public completion request. | Provider or shared configuration support is not a per-invocation plugin contract. Unset controls do not block inference; incompatible explicit overrides remain preserved and fail preflight with an explanation. |
| Capability information | Loops can use the host model catalog's temperature compatibility flag. The additive `modelConfig.resolveModelRuntimePolicy` reads authored model/provider runtime policy. Its other Advanced descriptors identify the pinned completion contract. | `runtime.llm` has no `capabilities` member, and runtime policy does not project runtime availability or sampling ranges/defaults. This is not a claim that OpenClaw has no other capability APIs. Full selected-runtime sampling support remains unqualified. |
| Completion result | Text, actual provider/model/agent, optional provider response model/terminal reason, usage, runtime execution owner and caller audit. Loops separately records the settings it submitted to the host. | Optional `responseModel`/`stopReason` do not attest an effective account, normalized settings or provider-applied settings. `transmittedToHost` is plugin submission evidence; it is not provider transport evidence. Applied settings remain `unknown`. |

Accepted [PR #159](https://github.com/Jacob-J-Thomas/openclaw-loops/pull/159)
provides Advanced lifecycle, zero-value, preflight and concurrent-isolation
mechanics, including a mounted production editor with synthetic transport.
Accepted [PR #160](https://github.com/Jacob-J-Thomas/openclaw-loops/pull/160)
provides six actual Codex/Ollama selected-model journeys on the same inherited
node through native UI, command and agent tools. Their original source/archive
receipts remain authoritative for those exercised paths. Neither receipt
establishes sampling transport, applied reasoning or effective account identity.
This consumer does not recast fixture output or generated text as such evidence.

Fresh issue readback on September 14 confirmed that
[#127561](https://github.com/openclaw/openclaw/issues/127561) and
[#90193](https://github.com/openclaw/openclaw/issues/90193) remain open. The former
addresses the configured `top_p` alias; the latter covers duplicate Codex
completion transports. Neither supplies the full per-call forwarding,
capability discovery or settings-attribution contract. Full SDK01 adoption is post-1.0; a later released public contract and actual transport qualification would be needed for those enhanced claims. This qualification adds no host patch, provider client,
shared-configuration change or new compatibility claim.

## SDK02 consumer qualification — September 20, 2026

The [compile-only consumer](https://github.com/Jacob-J-Thomas/openclaw-loops/blob/main/test/contracts/sdk02-consumer.ts)
checks `openclaw/plugin-sdk/core` and `feature-plugin` against the pinned
**2026.9.5** peer without a runtime or provider call. A command context has an
optional invocation-bound `runtimeContext.llm.complete`; tool and
session-action types lack those named members. This is a property of those
named interfaces, not an absence claim for other host APIs. The ordinary
isolated completion request accepts `execution.authProfileId`, but host policy
decides whether that requested account binding is authorized. Its result names
provider/model/agent/runtime owner and caller, plus optional provider response
model and terminal reason, without effective-account or applied-reasoning
attestation.

Accepted [PR #160](https://github.com/Jacob-J-Thomas/openclaw-loops/pull/160)
retains six actual Codex/Ollama routes for the same inherited node. Its Codex
agent-tool route first returned `HOST_POLICY_DENIED` after a host session
account binding; after the dedicated profile explicitly granted
`plugins.entries.loops-poc.llm.allowAuthProfileOverride`, fresh agent-tool and
native UI routes completed. The preserved receipt identifies actual
provider/model/agent/runtime owner and requested reasoning, while effective
account and applied reasoning remain `unknown`. It proves neither two-account
isolation nor transparent account inheritance.

Bolt #57's retained ordinary-install evidence records a real post-turn
`HOST_ABORTED` loop attempt and restart-preserved uncertainty when the public
invocation signal ended. This is request-lifetime evidence, not durable
authority. A durable model-only runner remains unadopted until its account,
authority, cancellation and settlement semantics are qualified under SDK02/06.
This consumer and reused evidence do not change host policy, credentials,
profiles, providers or runtime behavior.

## SDK04 consumer qualification — September 19, 2026

The [compile-only consumer](https://github.com/Jacob-J-Thomas/openclaw-loops/blob/main/test/contracts/sdk04-consumer.ts)
checks the pinned **2026.9.5** public `runtime.subagent` contract for a named
tool-free `run` with idempotency and `completionDelivery:"current-requester"`,
plus `waitForRun` and `getSessionMessages` request shapes. It imports only
`openclaw/plugin-sdk/core` and makes no runtime, provider, Gateway or delivery
call. Type acceptance does not grant a requester, select a destination, or
establish successful or durable delivery.

An ordinary external plugin installed through `plugins install --link` was
then exercised on OpenClaw 2026.9.3/Node 24.16.0. The authenticated synthetic
`plugins.sessionAction` and a real `before_dispatch` hook entered through
public `GatewayClient` `chat.send` both rejected the named setting because the
host did not grant an active requester-bound scope. The WebChat terminal was
host-injected with zero model tokens; no subagent run was admitted. These are
two actual unbound negatives, not proof that another public delivery API is
absent and not a successful, post-request, or durable-delivery claim.

Fresh readback on September 19 found [#145021](https://github.com/openclaw/openclaw/issues/145021)
and [#117210](https://github.com/openclaw/openclaw/issues/117210) open, with
[#117212](https://github.com/openclaw/openclaw/pull/117212) open at
`2c64200ed4753df66c25f0924b5154632925def1`. The former is scoped cancellation
of host-bound current-turn delivery; the latter is outbound session
correlation. Neither readback supplies a supported requester-bound destination
or durable completion authority. The post-1.0 SDK04 backlog remains open for a supported
destination, completion after request end/restart, permission reauthorization,
and dedupe. SDK02 account authority and SDK06 cancellation/physical-settlement
qualification remain separate future enhancements.

## Future references

Historical issue matching is preserved in the [pre-rescope register](https://github.com/Jacob-J-Thomas/openclaw-loops/blob/0e0f5915f198f8da35da9a90b3465555ac22ea5d/docs/UPSTREAM_REQUIREMENTS.md). It records partial overlaps including sampling alias #127561, transport sharing #90193, approval attribution #115902, current-turn delivery cancellation #145021, session association #127977 and host-run cancellation #120139. Those are separate owners' scopes, not promises of Loops support.

If the owner later resumes upstream work, recheck released source, contributor ownership and accepted scope before acting. Preserve external-plugin packaging and qualify any adopted released API with exact source/host/package evidence. No local experiment or private patch is a supported installation prerequisite.

References: [model runtime](https://docs.openclaw.ai/plugins/sdk-runtime/models), [background work](https://docs.openclaw.ai/plugins/sdk-runtime/background-work), [feature plugins](https://docs.openclaw.ai/plugins/feature-plugins), [trust model](https://docs.openclaw.ai/gateway/security/trust-model).
