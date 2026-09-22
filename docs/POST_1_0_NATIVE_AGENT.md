# Native full-agent qualification (#242)

This Bolt qualifies the public external-plugin `runtime.agent.runEmbeddedAgent` route on OpenClaw 2026.9.5. It does not implement an Agent node, accept X08/X10, or claim provider/account parity. Source compilation and pure harness tests are separate from a real installed-host receipt. Until the lead executes the verifier successfully, native agent execution remains unproven by this candidate.

## Lead-controlled execution

Only the lead starts the Gateway/model proof, after reserving the sole inference worker. The verifier starts and cleans up its own disposable Gateway and client processes. It never starts a model server. Run from this candidate worktree with its pinned dependencies and supported Node 24.16.0 or 26.1.0:

```sh
node scripts/verify-native-agent.mjs /absolute/path/to/lead-native-agent-config.json
```

The explicitly supplied JSON has exactly `selection` and `models`. Selection requires `agentId`, `provider`, `model`, `thinking`, `timeoutMs` (1000–180000), and `contextTokenBudget` (4096–65536). `models` is the lead's OpenClaw model configuration, including the selected provider endpoint, explicit disposable provider key and selected model catalog row. The verifier does not infer a provider, inspect credentials, copy a personal profile or call provider APIs. It strips inherited provider-secret environment variables and configures a new workspace/state directory. Raw supplied configuration remains private. Do not supply personal credentials for this fixture.

Example selection (the lead must supply the real matching model configuration):

```json
{"agentId":"main","provider":"ollama","model":"qwen3.5:4b","thinking":"off","timeoutMs":120000,"contextTokenBudget":32768}
```

There are at most two agent admissions and no automatic retry. Admission one must perform a real `read` of an undisclosed randomized workspace seed and use it in the final answer. Admission two is cancelled only after observing the host's actual `model_call_started` callback while the original host promise is unsettled. Completion racing cancellation is a failed cancellation qualification. A ten-minute verifier deadline, 180-second maximum per admission, eight observed tool-result cap, selected read/write surface and a 1024-token output hint bound the experiment. The output hint is best-effort host/provider behavior; the context ceiling is not an aggregate-token or financial budget. Returned result text is capped at 8192 characters; complete native results and tool receipts stay private.

## Authority and public seams

The temporary fixture is an ordinary external plugin loaded from a generated manifest. It uses public exports `plugin-sdk/plugin-entry`, `plugin-sdk/agent-harness` and `plugin-sdk/gateway-runtime` only. Operator `plugins.sessionAction` calls supply real current session identity; the fixture rereads `runtime.config.current()` and latest host session entry, resolves its configured workspace/store, and wraps execution in `session.runWithWorkAdmission` through final promise settlement. `prepareWorkspaceAuthority` supplies confinement facts, not exec permission. The runtime receives the exact host session target and durable persistence mode.

The no-model `prepare` action creates a caller handle bound to the current owner, session generation, workspace and explicit selection. A separate `execute` action rechecks those facts and current policy, then keeps its original public action promise pending through native settlement. The verifier uses a separate client to inspect or cancel while that execution RPC remains open. Its RPC deadline is the selected model timeout plus 30 seconds, capped by the remaining ten-minute global budget; the model timeout itself stays unchanged. Returning an early handle from the executing action would release its host request admission before lazy native work is admitted.

A fresh required `runId` is caller correlation only. The fixture does not supply `admittedRunContext`, `preparedRunAdmission`, sender-owner flags, scheduled authority, exec overrides, auth-profile IDs or synthetic host task identities. It never copies session metadata to create authority. Requested agent, role, model, reasoning and workspace are retained; actual provider/model/usage/tool receipts are observed independently. No claim of applied reasoning is made from a requested value.

`toolsAllow` requests only read/write, while the current host configuration denies write. A public native tool-factory inventory must observe read present and write absent. This is classified as host policy selection, not a model attempting a forbidden tool. The positive run separately requires an actual read-tool result callback. After an owned restart, host configuration denies read too and the fresh inventory must reflect that change without another model admission.

## Serial evidence and negative classifications

The verifier retains raw responses and errors before assertions, then exercises:

1. Host-created read/cancellation sessions and current native-tool policy; read-only Gateway scope denial.
2. Real durable agent loop, authored role prefix, native read receipt, exact seed-bearing answer, observed model and nonzero returned usage.
3. Foreign-record refusal, explicitly classified as a fixture owner check rather than a host cross-session denial.
4. Public `chat.history` assistant readback containing the seed; user prompt text alone cannot satisfy this check.
5. Active cancellation and final original-promise settlement. This proves local drainage, not remote-provider physical stop.
6. Owned Gateway restart: exact fixture record and public transcript readback; fresh host policy excludes read/write.
7. Public session reset with honest handling of a reset that preserves identity/generation, then delete/recreate using the same public key. Old record access must fail under the fixture generation guard. No state-file edits.

The fixture persists its private owner-bound records and original native result/error files. Startup labels any interrupted records without replaying them or calling them settled. Prepared records have no active promise and do not consume an admission. It rejects concurrent executions and repeated cases; service stop aborts and drains owned promises. A failed case stops the serial proof. Any revised experiment needs a changed falsifiable hypothesis and a new recorded lead disposition, never an unchanged repeat-until-green.

Raw profiles, seed contents, prompts, transcript records, tool results, errors and configuration stay under ignored `.dev-profile/`. Sanitized receipts under ignored `evidence/post-1.0/issue-242/` contain selected identities/hashes, numeric usage, named observations and cleanup facts. No sanitized receipt is emitted while any owned process remains alive, and no success is emitted without both local native-promise settlement and the final execution RPC response. A local RPC timeout is not evidence of host request settlement. Cleanup aborts/drains active native calls, then drains execution responses before closing clients. The source/head, fixture, verifier, selected host files and explicit config are hashed. Preserve failed receipts.

## Preserved first experiment and bounded repair

The first native experiment at `e476d3a5bc47ef286139a4c6ffd7fb81afb51772` rejected admission with `GatewayDrainingError` before any execution phase or model call. Its failed receipt and raw evidence remain unchanged. The Gateway was ready before the request and began shutdown only after the rejection. Pinned host source checks whether the inherited request admission has been released; the original fixture returned its action response while deferred native admission was still pending. This motivates the preparation/awaited-execution repair, not a host-policy bypass or an operational success claim.

The second experiment keeps the selected model, two-admission cap and time budgets unchanged. Its falsifiable first expectation is that admission reaches workspace authority and actual native execution callbacks while the action request remains open. The first case must still prove real tool use, observed attribution and durable output before the cancellation case is admitted. Any earlier or different failure is retained and stops this experiment; no automatic retry is permitted. Runtime qualification of this repair requires a new exact-source lead run.

## Pure checks

`test/contracts/native-agent-consumer.ts` compiles the exact public run/session/tool-event shape and excludes host-only admitted-context fields. `test/native-agent-sdk.test.mjs` checks selection bounds, authority provenance, awaited action response ordering and RPC budget bounds, JSON-safe attribution, real-tool/cancellation evidence requirements, durable assistant detection and receipt redaction. These tests invoke no host agent, Gateway or model and are not operational proof. Run the focused tests/typecheck, then the normal repository and extracted-package gates before the lead's exact-candidate native qualification.
