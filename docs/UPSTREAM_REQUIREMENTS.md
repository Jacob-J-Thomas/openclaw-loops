# OpenClaw upstream dependency register

Reviewed September 12, 2026. The active deliverable is the [standalone 1.0 plugin](DELIVERY_PLAN.md). Upstream changes belong in separate OpenClaw issue-linked PRs. This register records dependencies and candidate contribution scopes; it does not claim maintainer acceptance, merge, release or Loops integration where those have not occurred.

## Verified baseline

- Installed/tested plugin peer: **OpenClaw 2026.9.3**. Keep this exact dependency until a newer release passes qualification.
- Latest published upstream release at review: [v2026.9.4](https://github.com/openclaw/openclaw/releases/tag/v2026.9.4), published September 11, commit `3a9d69db306cd7f081e06254cb89c4bcc14a7107`. Its source was inspected; this is not a completed Loops compatibility test.
- Upstream main inspected at `a0cd0b81391c73885079799ea80f4351c85552b8`. Main and local SDK experiments are not supported release dependencies.
- The installed 2026.9.3 declarations and [2026.9.4 runtime contract](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/src/plugins/runtime/types.ts) already expose `subagent.run({disableTools:true})`, idempotency, wait/inspection and `completionDelivery:"current-requester"`. Neither inspected contract exposes `subagent.abortSession`. Declaration presence alone does not establish availability from every external-plugin invocation context or durable requester authority.
- The [2026.9.4 completion contract](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/src/plugins/runtime/types-core.ts) still exposes only advisory temperature/maxTokens and normalized reasoning as generation controls. Isolated completion accepts a fresh single user prompt and an optional host-policy-gated `authProfileId`. A caller-provided account ID is not a host-attested account binding.

Issue state, linked PR state, source behavior and first containing release are separate facts. Recheck them at contribution and adoption time. An open issue may describe already-landed behavior; a related PR may fix only part of the requirement.

## SDK01 consumer qualification — September 14, 2026

The [compile-only consumer](https://github.com/Jacob-J-Thomas/openclaw-loops/blob/main/test/contracts/sdk01-consumer.ts) imports
`OpenClawPluginApi` from the supported `openclaw/plugin-sdk/core` export. The
normal `npm run typecheck` gate checks inherited and explicit-override requests
against the pinned **2026.9.3** peer. It makes no runtime or provider call.
Its key assertions deliberately require renewed qualification when the peer
changes; an absent member assertion describes that named interface only.

| Public contract | Available behavior | Qualification limit |
|---|---|---|
| `runtime.llm.complete` isolated request | One fresh user prompt; optional model, temperature, output-token limit, reasoning and cancellation signal. Omitting generation overrides inherits host behavior. Explicit temperature `0` typechecks. | Temperature and `maxTokens` are documented advisory hints. Type acceptance does not establish model validity, normalization or provider enforcement. Loops still requires a positive output-token limit. |
| Additional sampling overrides | The requested top-p/top-k/min-p/typical-p, penalties, seed and stop keys are absent from this public completion request. | Provider or shared configuration support is not a per-invocation plugin contract. Unset controls do not block inference; incompatible explicit overrides remain preserved and fail preflight with an explanation. |
| Capability information | Loops can use the host model catalog's temperature compatibility flag. Its other Advanced descriptors identify the pinned completion contract. | `runtime.llm` has no `capabilities` member. This is not a claim that OpenClaw has no other capability APIs. Full selected-runtime sampling ranges, inherited values and support descriptors remain unqualified. |
| Completion result | Text, actual provider/model/agent, usage, runtime execution owner and caller audit. Loops separately records the settings it submitted to the host. | The result has no normalized/transmitted generation-settings receipt. `transmittedToHost` is plugin submission evidence; it is not provider transport evidence. Applied settings remain `unknown`. |

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
capability discovery or settings-attribution contract. SDK01 adoption remains
open until a released public contract and actual transport qualification meet
those requirements. This qualification adds no host patch, provider client,
shared-configuration change or new compatibility claim.

## Required plugin-facing contracts

| ID | 1.0 requirement | Existing issue coverage | Remaining gate |
|---|---|---|---|
| SDK01 | Typed per-call inference overrides and runtime/model capability descriptors; inheritance, explicit zero and honest normalization/transport attribution. | #127561 covers one configuration alias. #90193 concerns shared Codex completion behavior. Neither covers the complete parameter/discovery contract. | Agree the residual public completion contract with its owner, implement and release it. Verify real Ollama transport, native Codex reasoning, unsupported/advisory values and concurrent isolation. No global configuration mutation. |
| SDK02 | Effective model/runtime/account selection and cancellation authority consistently bound to the UI, command or tool invocation. | #122172 provides a model-only durable execution candidate already visible in releases; #90193 is partial transport parity; #141438 is a backend-specific sender-context defect. | Prove or extend request-bound completion for all entry paths, waits and retries, with two distinct accounts on one provider. Do not infer credential ownership from sender IDs or fall back to the operator's credentials. |
| SDK03 | Authenticated initiating principal, current target-session read/control permission, permitted agent inventory and history/recovery across reset. | #115902 originally requests principal exposure, but its accepted scope is approval attribution only. #127977/PR #127982 supplies plugin-scoped session state, not authorization. | Obtain the remaining host authorization contract and test owner/member/read-only/other-session/reset/reassignment cases. Do not build a second identity or team-permission system inside Loops. |
| SDK04 | Authorized completion after request end and restart; host-selected destination, dedupe, cancellation and permission revalidation. | #145021 addresses per-send cancellation; #117210/PR #117212 adds outbound session correlation. Existing current-requester APIs need context/lifetime qualification. | Prove a supported durable external-plugin route or extend the existing host delivery lifecycle. Persist Loops delivery state, preserve uncertain outcomes and prevent cross-session/duplicate delivery. Correlation metadata is not delivery authority. |
| SDK06 | Cancellation of a durable host run without deleting its session; observable physical settlement and ownership enforcement. | #120139/PR #120140 is the direct candidate. Ordinary single-completion AbortSignal support already exists. | If the durable runner is selected, adopt the released cancellation contract and verify plugin ownership, completion/cancel races, cleanup, restart and transcript preservation. Do not treat deleting the session as cancellation. |
| SDK05 | Native tools, plans/goals, compaction, subagents and broad host integrations. | Revisit relevant owner issues when their expansion milestone is admitted. | **Deferred after 1.0.** These capabilities are not dependencies just to finish the existing nine-node palette. |

No exact open issue was verified for the entire SDK01 capability-discovery surface or the entire SDK02/03/04 request-bound contract. Those gaps remain named requirements. Present a minimal failing plugin example and the smallest proposed extension to the relevant existing issue owner; use a focused follow-up only if the owner separates the work. Do not attach unrelated functionality to a bug-fix PR or claim a broad issue will automatically accept it.

## Existing issues and contribution disposition

All issue rows below were open when checked. PR states were fetched separately. Scope statements distinguish original requests, current source and accepted maintainer direction.

| Issue | Verified PR/source state | Loops contribution and limit |
|---|---|---|
| [#122172 — durable model-only plugin subagent runs](https://github.com/openclaw/openclaw/issues/122172) | [PR #122184](https://github.com/openclaw/openclaw/pull/122184) closed without merge; `disableTools` exists in both inspected released contracts. | **Adopt/qualify first.** Trace the introducing implementation and release provenance; add missing regression evidence only if a current defect remains. Test literal zero tools, no leaked parent context, single-completion behavior, account/settings parity, cancellation and requester lifetime. Do not open another implementation merely because the issue is open. |
| [#120139 — stop a plugin run without destroying its session](https://github.com/openclaw/openclaw/issues/120139) | [PR #120140](https://github.com/openclaw/openclaw/pull/120140) open, author `amoghasgekar`, head `9f3bb9374a200931b76947a8411f66f1a6c12c6a`. Public abort absent from inspected release/main types. | **Contribute to existing candidate.** Supply ownership-negative, stop/wait settlement, repeated cancel, restart and transcript-preservation cases. Review the same public abort path and guard; keep runtime changes out of this repo. Dependency is conditional on choosing durable subagent execution for an inference attempt. |
| [#127977 — plugin-scoped durable session-extension access](https://github.com/openclaw/openclaw/issues/127977) | [PR #127982](https://github.com/openclaw/openclaw/pull/127982) open, author `Giantswr86`, head `1a1187101057f7133616f19a862b884daea4cb85`. Proposes plugin-ID-bound get/set/clear through existing persistence. | **Contribute integration cases, avoid duplicate PR.** Verify namespace isolation, later-turn/restart access and reset/disable semantics. Use only for the host-owned session association if needed. Loops retains its own definition/run SQLite database. Whole-session read helpers are not equivalent to this scoped facade. |
| [#127561 — configured top_p silently dropped](https://github.com/openclaw/openclaw/issues/127561) | Maintainer-authored issue; reviewed source path projects `topP` but omits the accepted `top_p` spelling. No implementation PR was identified in this review. The broader runtime contract is still narrow in 2026.9.4. | **Narrow repair candidate after fresh reproduction/owner coordination.** Normalize at the existing shared boundary, preserve override precedence/provider filtering, test both OpenAI transports and explicit zero. This addresses inherited configuration only; SDK per-call forwarding and discovery require separate scope. |
| [#90193 — duplicate Codex Responses paths for turns and llm.complete](https://github.com/openclaw/openclaw/issues/90193) | Incident fix [PR #90205](https://github.com/openclaw/openclaw/pull/90205) merged June 4. Broader refactor remains an owner decision; no current failing request was established by the issue review. | **Do not repeat the incident fix.** Use shared validation/transport cases where the owner sponsors them. Preserve runtime ownership, OAuth/base-URL handling and model/account semantics. Neither this issue nor a transport refactor alone grants request-bound authority. |
| [#115902 — authenticated operator principal](https://github.com/openclaw/openclaw/issues/115902) | Assigned to `vincentkoc`. [September 11 accepted scope](https://github.com/openclaw/openclaw/issues/115902#issuecomment-5641921911) is winning operator-approval attribution only. Related [PR #145592](https://github.com/openclaw/openclaw/pull/145592) is closed, unmerged and draft at review. | **Coordinate the remaining scope with its owner.** Approval attribution is useful evidence, not a general principal/session-ACL API. Do not extend that PR into Loops authorization or assume its closure supplied the missing contract. Existing approval state/retention/authority rules remain owned by OpenClaw. |
| [#145021 — cancel host-bound current-turn delivery](https://github.com/openclaw/openclaw/issues/145021) | Open feature request for an optional restrictive AbortSignal on `delivery.send`; no matching implementation PR identified. | **Focused SDK contribution candidate.** Preserve host route/requester/media/turn/registry authority; test pre-abort, abort during preparation and multipart dispatch, and accepted/unknown outcomes. This must not extend a current-turn capability's lifetime or select another destination. Durable delivery remains separate qualification. |
| [#117210 — canonical session key for outbound adapters](https://github.com/openclaw/openclaw/issues/117210) | [PR #117212](https://github.com/openclaw/openclaw/pull/117212) open, author `usedhonda`, head `2c64200ed4753df66c25f0924b5154632925def1`. | **Review/reuse if relevant to the selected delivery path.** Test originating versus absent-session metadata. It is correlation only: no account grant, authorization, persisted outbox or cross-reset delivery entitlement. Not an unconditional 1.0 dependency. |
| [#141438 — claude-cli loses requesterSenderId in plugin tools](https://github.com/openclaw/openclaw/issues/141438) | Open backend-specific identity propagation report; no directly matching implementation PR identified. | **Conditional host parity repair.** Reproduce on the selected release before accepting that backend in the compatibility matrix. Forward only host-attested caller facts across the CLI tool bridge; test distinct senders and absent identity. This cannot substitute for SDK03 authorization. |
| [#73488 — per-conversation identity at provider stream entry](https://github.com/openclaw/openclaw/issues/73488) | Original request asks for factory context, while review finds existing per-call `StreamOptions.sessionId` and remaining caller gaps. | **Conditional provider integration work.** Prefer the existing per-call identity contract and prove isolation before adding another field. Session correlation does not establish an authenticated principal or account selection. |

Related host reliability reports belong in qualification, not automatically in the Loops feature backlog: [#146265](https://github.com/openclaw/openclaw/issues/146265) reports closed async-work scope after restart; [#145506](https://github.com/openclaw/openclaw/issues/145506) reports delivery capability loss after compaction. Exercise real post-restart agent tools and legitimate delivery on the selected host; health checks alone do not cover these paths. Open a scoped contribution only after reproducing a relevant failure.

Keep [Lobster adapters #90909](https://github.com/openclaw/openclaw/issues/90909), [workspace attachment delivery #128073](https://github.com/openclaw/openclaw/issues/128073), and [managed Task Flow attachment #138998](https://github.com/openclaw/openclaw/issues/138998) outside the mandatory 1.0 dependency set unless a concrete existing-palette acceptance case proves otherwise. Loops does not need a second workflow engine, attachments, or managed full-agent flows to return its stored text/JSON results.

## Contribution workflow and acceptance

1. Refresh issue state, assignee, accepted scope, linked PRs, released source and repository contributor/owner guidance. Reproduce the exact remaining behavior through a minimal external plugin; classify configuration or unavailable runtime separately from an SDK defect.
2. For an existing candidate, prepare focused test/review improvements with its author; use their contribution path or an agreed follow-up. For uncovered work, prepare one generic host change per agreed contract with the issue linked. Use `Closes` only when the entire accepted issue scope is satisfied; otherwise use `Related` and name the residual.
3. Work in a separate OpenClaw fork/checkout and issue branch. Keep Loops code, schemas, database and product policy out of the host PR. Keep host source, patches, build outputs and provider code out of the plugin repository and package. Preserve contributor attribution and current PR ownership.
4. Test the real owner boundary: SDK types/exports, external-plugin loader, runtime/caller forwarding, authorization negatives, cancellation settlement, concurrency/restart and compatibility. Capture actual model transport settings where observable. Do not infer enforcement from generated prose.
5. Submit the focused PR, address review, and verify the exact merge and first containing release. Our contribution authority does not grant upstream merge/release control. Track blocked dependencies while continuing independent plugin work.
6. Pin that released host in Loops; adapt only through its supported external-plugin APIs. Run ordinary packaged installation and UI/command/agent scenarios with real Codex and Ollama, distinct accounts, team roles and isolated customers. Record the source, host version, package hash and results before updating support claims.

Every required dependency needs a receipt containing: SDK requirement ID, issue, accepted scope, candidate/PR and owner, tested head/base, reviews/checks, merge SHA, containing release, public API, plugin consumer commit, fixture evidence, live evidence and unresolved limits. No published plugin version may require applying local patches to OpenClaw.

## Earlier local experiments

Three uninstalled, unpublished OpenClaw commits (`381afd2238dd694519be89823f2903eb736b1123`, `7fd7ed268058ef43e1ebc666da947582daf48afa`, `8597f6dafb2685ed3977b62d78d837e480c5ed1c`) explored sampling forwarding, native Codex reasoning and Ollama parameter mapping. Their base was `1e802bc6982e035fe74bda7700a129d567f11554`, not the current published release. They have local fixture/type/build/review evidence and one successful real Ollama transport capture through a prepared-runtime test seam. They do not prove complete request-bound authority or upstream acceptance.

Retain these experiments and evidence privately. Reuse their tests or small changes only after comparing the current issue/PR scope and upstream source. Do not publish the patch stack inside Loops, install it as a hidden prerequisite, or describe it as supported OpenClaw. The proposed generic `api.runtime.jobs` design is superseded as the default approach: start with existing runtime capabilities and accepted issue work; any additional contract needs a demonstrated residual and owner agreement.

References: [model runtime](https://docs.openclaw.ai/plugins/sdk-runtime/models), [background work](https://docs.openclaw.ai/plugins/sdk-runtime/background-work), [host hooks](https://docs.openclaw.ai/plugins/sdk-overview/host-hooks), [state/system](https://docs.openclaw.ai/plugins/sdk-runtime/state-and-system), [multi-user](https://docs.openclaw.ai/concepts/multi-user), [trust model](https://docs.openclaw.ai/gateway/security/trust-model).
