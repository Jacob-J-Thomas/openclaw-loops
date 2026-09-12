# Local verification

## Alpha.9 theme and Advanced-settings verification

Both isolated Gateways now run **1.0.0-alpha.9**, tarball SHA-256 `9430a9c85cff87eb1e60aa3443fe9bf0bbc96ca0c947343f17e7ccc2d7581052`. Their backend, worker and native UI hashes match the artifact. Backend and worker bytes are unchanged from alpha.7. The theme changes passed the full **115-test** source check and build as alpha.8; the final placeholder-only follow-up passed a fresh build and **21 extracted-package SDK tests** as alpha.9. Evidence: `evidence/release-alpha8/` and `evidence/release-alpha9/`.

Browser testing reproduced the original defect: OpenClaw was set to Light while Loops remained dark. The native page now inherits the host's resolved color scheme without reading private host state or maintaining another preference. Both explicit Light and Dark modes were verified, including canvas controls, the inference inspector and Advanced capability explanations. The original System selection and normal viewport were restored afterward.

The rendered-text sample contained 133 elements, with minimum contrast **4.92:1** in Light and **6.43:1** in Dark after expanding the version controls. An initial dark probe included closed disclosure descendants with stale computed background colors; its apparent failures were checked against the actual expanded controls and did not reproduce. That diagnostic probe is retained separately from `dark-contrast-expanded.json`. These measurements cover sampled text, not a complete accessibility audit.

Advanced placeholders were a separate confirmed issue. The installed follow-up measures **5.59:1** in Light and **6.99:1** in Dark. Empty controls still inherit the host settings; this display repair does not change requested generation parameters. Temperature and output tokens remain advisory on the pinned completion API, while top_p, penalties and other unavailable controls retain explicit explanations.

Full stopped-state backups are retained under `.dev-profile/backups/before-alpha8-1789187521776` and `.dev-profile/backups/before-alpha9-1789188293193`. Every definition and run record remained byte-for-byte unchanged through both upgrades; both stores pass integrity checks at schema 2. No model-server or personal-profile changes were made. Full screen-reader/browser/device acceptance and the remaining release and expansion work are still open.

## Alpha.7 actionable errors and authoring verification

The alpha.7 artifact passed **115 source tests** on macOS under Node **24.16.0** and **26.1.0**, typecheck, lint, both builds, and **21 extracted-package tests through the actual OpenClaw feature SDK**. Tarball SHA-256: `9221e5d68bcaf4d741875cc4c241cc07565fce43b68f03cba0885e9596d220bc`. Both isolated Gateways successfully launched the package at this checkpoint; installed backend, worker and native UI hashes match the tarball. Evidence: `evidence/release-alpha7/`. Subsequent documentation changes are separate from the packaged artifact.

A stopped-state backup is retained at `.dev-profile/backups/before-alpha7-1789186695156`. The upgrade preserved every definition and run record byte-for-byte (Codex: 9 definitions including one archived/deleted record, 124 runs; Ollama: 6 definitions, 24 runs); both SQLite integrity checks passed at schema 2. No model-server or personal-profile changes were made.

The previously failing live removed-history replay assertion now passes after restart. The plugin returns a typed `loops-error` with `LOOPS_HISTORY_REMOVED`; no replacement execution is admitted. Its shared UI client surfaces known operation failures, including stale revisions and invalid inputs. The real feature SDK tests assert that failed calls do not dispatch inference or overwrite the saved definition. Unexpected exceptions remain subject to OpenClaw's masking behavior; this is not a claim that every host error path is complete.

Native browser acceptance at **390 × 844** used keyboard activation to create and enable a dedicated synthetic loop. A concurrent session action saved revision 2 while the browser held revision 1 edits. The stale save opened the conflict UI; an explicit field choice plus merge saved revision 3, retaining the browser's name/node label, the other editor's independent description and enabled publication revision 1. All three immutable versions remain. Actual state assertions and before/after browser evidence are in `codex/authoring/` and `ui/`.

Dark canvas controls and destructive/text buttons are readable in the captured desktop and mobile screenshots. A broader acceptance claim is still pending: browser inspection found faint muted labels, and the plugin must follow host theme overrides as well as system preference. The normal viewport was restored after the narrow-screen check. This remains an alpha, not 1.0 release acceptance.

## Alpha.6 history and durability verification

The alpha.6 artifact passed **114 source tests** on macOS under Node **24.16.0** and **26.1.0**, plus typecheck, lint, both builds, and **20 extracted-package SDK tests**. Tarball SHA-256: `3bfdb3c7368c5a707ccb378cc28b7ca7beebe3ec53d688d58ffe29af0c2d8ae6`. Both isolated Gateways ran that artifact at this checkpoint; backend, worker and UI files match the tarball. Evidence is under `evidence/release-alpha6/`. Documentation and live-verification helper edits made afterward are separate from the packaged executable identity.

Both live SQLite stores upgraded from schema 1 to 2 with verified automatic backups. All pre-existing definitions and run counts were unchanged immediately after migration (Codex: 8 definitions/21 runs; Ollama: 6 definitions/24 runs). Full stopped-state backups are retained under `.dev-profile/backups/before-alpha6-1789184971882`.

The dedicated Codex conversation `agent:main:dashboard:e34e4747-f56a-4d13-9ccb-6ea63653a8b0` received 105 synthetic deterministic runs. The live API and native UI showed pages of 100 and 5 without losing rows. The UI previewed and removed one oldest run while retaining 104. A real Sol agent then called `loops_retention` twice, previewing and applying the same plan to remove exactly one more run and retain 103. The recorded tool calls and results agree with saved history. No existing conversation or definition was targeted for cleanup.

Negative live acceptance found an unresolved error surface: replay of a removed request is rejected, but OpenClaw's session-action handler replaces its actionable message with `plugin session action failed`. The strict replay-message assertion is preserved as a failure; this does not establish the complete R05/R09 live gate. Known safe typed operation failures need to cross the public feature result contract.

Regression tests cover SQLite refusal of a completed run, failure of both commit and readback, atomic rollback of pruning/admission tombstones, stale cleanup previews, conversation isolation, ancestry protection and physical cleanup after cancellation. These are fixture failures, not claims of a completed disk-full/process-crash/soak matrix. The dark-theme browser check also identified graph-control and destructive-button contrast work still to finish.

## Alpha.5 acceptance — September 11, 2026

The installed alpha.5 tarball passed **105 source tests**, types, lint and both builds, plus **19 extracted-package tests through the actual OpenClaw feature SDK**. Tarball SHA-256: `89c52da82c3fec26f51c3978e04c1b69edf218d761cfd00d971342c0e7378a89`. Package metadata and test evidence: `evidence/release-alpha5/package*.json`. Both isolated Gateways started successfully from that artifact after an idle-state backup at `.dev-profile/backups/before-alpha5-1789181933`. No personal profile was changed. Subsequent documentation and verification-script edits are separate from this installed artifact.

New implementation: chunked large JSON inputs, immutable conversation-scoped paged results, client-side digest verification, operator-configurable v2 budgets, human `/loops review` commands and recovery of structurally intact but unfinished local drafts. Build generation now derives manifest tool inventory and configuration from the source contracts. Existing host authority remains in force for uploaded inputs and every document read. Snapshots survive restart; cross-conversation and corrupt-document tests fail closed. Physical/scale/retention/host-authority gaps still prevent 1.0 acceptance.

Installed acceptance:

- Codex command `580e3955-8409-4d40-8b26-114a0449474d` completed with Sol. Agent tool run `775d6357-9a93-4b99-8aa4-68ad8a509208` was newly executed and its ID/result reported.
- Large-data run `0e78a788-c335-42c1-9f8d-ade28c75aaac` accepted 80,000 Unicode code points (including emoji, nulls, quotes and backslashes), retained the exact input/result, and returned a large immutable run snapshot. A large definition then saved/read correctly. The synthetic loop was archived. The live test used 174 bounded Gateway requests, recorded in `evidence/release-alpha5/codex/transport/`.
- The native UI automatically fetched that large inspector result and displayed Completed, the exact run ID and the Result region. The existing Advanced node still shows temperature `0` and output tokens `128`, plus accurate advisory/unsupported status. Evidence: `evidence/release-alpha5/ui/`.
- The original feature-matrix revision 4 is unchanged and its completed result is now saved in `evidence/release-alpha3/matrix/run.json`.
- Ollama's repeated natural-language prompt first reported an old run ID. A fresh conversation produced actual tool run `abb7c58d-7c62-454a-a0fe-32ef9ad2d9d2`, but the model copied the previous user-command input instead of the newly requested input. Both diagnostic attempts are preserved under `evidence/release-alpha5/ollama/`. They are not accepted as exact-input end-to-end agent evidence. The verification script now requires a fresh run containing this test's unique input marker and an agent reply containing that run ID; a clean exact-arguments rerun passed. New tool run `65df1e02-a54a-4fe0-b359-76a4f26b3ee8` retained the specified input marker and was reported by the agent; user-command run `8d1cde28-dee8-4e42-a190-6dbe1fb2adbc` completed against the same saved revision. `verify-release.mjs ollama assert` passed. This verifies invocation and data flow, not factual summarization quality: the 4B output incorrectly interpreted the synthetic marker as an admission requirement. Evaluation/quality checks remain part of the accepted expansion scope.

CI/public source/ClawHub and the remaining deployment/fault/soak/expansion gates remain open. Automatic approval review rejected creating/pushing the public GitHub repository for the prepared source payload; nothing was published and specific approval remains pending.

## Alpha.4 acceptance — September 11, 2026

The alpha.4 executable package passed **96 deterministic tests**, types, lint and both builds, plus **17 extracted-package SDK adapter tests**. It is installed in both isolated dev Gateways (Codex 19691; Ollama 19491). CI is configured but has not run yet. This is incomplete release work, not 1.0 acceptance.

New source covers concrete output contracts, v2 inherited timeouts with elapsed-time accounting, persisted browser drafts, optimistic three-way merge, per-node agent controls, archive recovery and small-screen history layout. Live UI testing caught an undefined optional archive timestamp rejected by the host's bounded-JSON validator; the actual SDK regression and UI retest now pass. A missing merge base also requires explicit choices instead of discarding recovered edits. The fresh-page draft recovery journey successfully restored and saved `draft-recovery-acceptance`, then archived and recovered it through the UI. Raw UI evidence: `evidence/release-alpha4/ui/`.

The user's **unchanged feature-matrix revision 4** executed with Sol in the synthetic Codex conversation: run `8b68f438-5e76-4842-8736-3acffe72c5ba`. It passed all six success predicates, model metadata, text and JSON completion, and one successful Repeat iteration. Its manual Wait was continued; the resulting Review survived an alpha.3-to-alpha.4 Gateway restart with the same evidence. Exercising the authenticated UI approve path completed with `{"ok":true,"equalsValue":"same","lessThanValue":42,"truthyValue":true}`. This was an automated synthetic UI acceptance test, not an independent human approval. The original definition/publication remained unchanged. Evidence: `evidence/release-alpha3/matrix/` and `evidence/release-alpha4/ui/matrix-completed-ax.txt`.

Alpha.3's UI run `e1f97776-85ce-4409-a8d1-a5dd0a7c828f` completed with the saved temperature `0` / output tokens `128` and result `UI inference verified.`. After increasing only the isolated Ollama context to 32K, real agent run `cb0b82b7-5ec9-4721-bb24-8c4eee6e6bed` completed and the agent reported its actual ID/result. That successful chat reporting used installed alpha.2; subsequent alpha.3 command evidence is recorded separately. The model's observed 32K allocation was 3,705,048,922 bytes, with one model/worker. This resolved the earlier 16K surrounding-chat overflow, without substituting a larger model. Current-artifact full command/tool rechecks remain part of the next gate.

Local runtime state, credentials, raw evidence and the supplied handoff are preserved on this device and excluded from the public source snapshot. CI publishes only synthetic package-test evidence and the built tarball. Exact local package metadata is in `evidence/release-alpha4/package.json`; later documentation-only repackaging must keep its artifact identity separate.

## 1.0 alpha work — September 11, 2026

The installed alpha.2 artifact passed 89 deterministic tests and extracted-package SDK adapter checks. Continued source work adds inherited v2 timeouts and concrete output schemas; that source currently passes 91 tests, typecheck, lint and both builds but has not yet been installed. This is incomplete release work, not 1.0 acceptance.

Both development stores migrated from JSON to SQLite with the original JSON and backups preserved. Existing `loops-feature-matrix` revision 4 remains enabled. Recognizable generated single-model policies were removed with config backups; custom policy is retained.

Live synthetic acceptance:

- Codex user command: `f7b935f0-1580-4038-923f-04e167c30dfc`, revision 1, completed with `openai/gpt-6-astra`.
- Codex agent: `58ea8089-ebb1-432b-93c6-4585bf2ccf29`, revision 1, completed with `openai/gpt-5.6-sol`. After alpha.2 installation, actual tool run `16c66612-6e3a-41aa-9f33-b447cc5638c2` also completed and was reported by the agent. Only the synthetic conversation was selected to use Sol.
- Native UI: `213029cb-345d-41b7-8e1c-ff1f9d6ceef4`, revision 1, completed with Sol and result `UI inference verified.`. The saved and reloaded inference node preserved temperature `0` and output tokens `128` under Advanced. Screenshot and accessibility evidence: `evidence/release-alpha/ui/`. The host accepts these fields as hints; this does not establish provider enforcement.
- Ollama user command: `db5c2e5c-9a6a-463c-960a-d468bc96b788`, revision 1, completed with `ollama/qwen3.5:4b`.
- Ollama agent: `4b947702-ea3f-4b7f-95b4-0b30813cbdc0`, revision 1, actually invoked by `loops_run` and completed with `ollama/qwen3.5:4b`. Its surrounding agent turn subsequently failed with context overflow at 16K. Loop execution is proven; successful end-to-end chat reporting is still a failing gate. The earlier alpha.1 wrong-input-shape attempt is preserved separately.

Evidence: `evidence/release-alpha/{codex,ollama}/` holds synthetic conversation and run records; `evidence/release-alpha1/` preserves the prior attempt; `evidence/release-alpha2/` contains the installed artifact metadata and package tests. Later builds must receive a new version and fresh artifact binding.

Remaining release and expansion gates are tracked in `DELIVERY_STATUS.md`.

## 0.3.0 agent activation and invocation — September 11, 2026

Installed in both isolated profiles: Codex at `http://127.0.0.1:19691` and Ollama at `http://127.0.0.1:19491`. Both session-effective inventories expose all **thirteen Loops tools**. This update implements the user's correction: enabled creation by default, optional drafts, agent activation/revocation, and edits that preserve or explicitly change activation. It supersedes the human-only activation behavior documented in the historical 0.1/0.2 sections below.

`npm run check` passed typecheck, lint, **61 tests**, backend build and native UI build. The extracted 0.3.0 tarball separately passed its **15 adapter tests against the released OpenClaw SDK**. New tests cover default enabled creation, explicit drafts, activation preservation/overrides, activation conflicts, host denial before committing definition/grants, invalid publish atomicity, pinned runs across enabled edits, disable versus revoke, and operator-write UI activation. These automated transports are deterministic fakes; the live proof below is real Codex inference.

A new **Loops activation verification** chat used **OpenAI Codex / gpt-6-astra** and actual plugin tools:

- Created `agent-activation-smoke-20260911`, ID `loop-09815f89-b32f-4a92-983a-73bfddba7bd8`, enabled at revision 1, and invoked it. Run `60b840d4-2f7e-4294-b325-dc3201bc3ef7` completed with a real summary of the garden sample. Node evidence attributes the isolated completion to the Codex harness and `gpt-6-astra`.
- Edited to enabled revision 2, then explicitly saved a disabled revision 3; read back each state. Used `loops_enable` to enable and then disable revision 3.
- Given a plain request to invoke that disabled loop, the agent called `loops_read`, `loops_enable`, and `loops_run`. Run `f07fef8e-4545-49a8-af7b-523701be50e5` completed at revision 3 with a real summary of the library sample. No human activation intervention was required.

The pre-fix browser showed a valid saved graph with **Enable revision** disabled because **Model completion** was unchecked. The new editor removes that separate checklist. Browser checks confirmed agent changes appear without reloading, enabled loops expose Run, and direct UI **Enable loop** / **Disable** work. A second temporary loop was created in the UI, saved as a disabled draft at revision 1, edited and **Save & enable**d at revision 2, then invoked from the UI. Its deterministic run `2b5b550c-4ccd-4a42-bb26-bd0e10f3ef00` completed with `UI activation verified`, with no UI alerts. This UI check does not claim an additional model call.

Both temporary definitions were deleted through the real agent tools, retaining all three completed run records. All pre-existing definitions retained their identity and revision. During verification, `loops-feature-matrix` changed from disabled to enabled revision 4 outside the test agent mutations; that concurrent activation was preserved. Every current Codex-library definition also passed graph validation. Screenshots under `output/playwright/`: `activation-before.png`, `agent-enabled.png`, `agent-disabled.png`, `ui-enable-working.png`, `ui-save-enable-run.png`.

Evidence is in `evidence/agent-activation/`: `verification.json` records assertions, native receipts, tool calls, installation hashes and final package binding; `chat-history.json` is only the dedicated synthetic test chat; `after-*.json` and `ui-*.json` record actual definitions/runs; `checks.log`, `package-tests.json`, installed metadata and effective inventories record the tested build and local installations. Documentation-only repacking preserves the verified executable hashes. Human review nodes retain their explicit human decision semantics; this change removes human-only loop activation, not the meaning of a Human review node.

## 0.2.0 agent authoring — September 11, 2026

Installed and verified **0.2.0** in both isolated profiles: Codex on `http://127.0.0.1:19691` and Ollama on `http://127.0.0.1:19491`. Both Gateways were restarted in place, and their session-effective inventories contain all **eleven Loops tools**, including the five authoring tools. Installed backend and browser asset SHA-256 hashes match the local build. Model selection, personal profiles and existing loops were preserved.

`npm run check` passed typecheck, lint, **53 tests** and both builds. The extracted tarball passed **14 adapter tests against the real released SDK**. Added checks cover reading disabled drafts, creation with fresh identity and no grants, field edits, strict schemas, stale revisions, library capacity, deletion during active/parked work, historical evidence retention, and authorization. Test discovery is scoped to this project's `test/` directory so development-profile copies of third-party Codex plugins are not collected.

The **Loops agent authoring verification** chat used real **OpenAI Codex / gpt-6-astra** turns. Its trace contains this successful sequence:

```text
loops_library → loops_read → loops_create
loops_read → loops_edit
loops_read → loops_delete → loops_library
```

The agent created `loop-058a6f32-0d1b-42fc-a0e9-5d48d2180f33` at revision 1, read and changed only its requested name and inference prompt at revision 2, then read the current revision and deleted it. Assertions confirm no grants were added, both saved revisions were disabled, all tool calls succeeded, and the final original-library listing equals the initial listing. The temporary loop was not executed. This proves Codex agent authoring, while the earlier loop-execution acceptance below used Ollama.

The authenticated native editor displayed the agent-created definition, then its edited name, revision and exact prompt. Run remained disabled. After deletion and page reload, the temporary draft was absent and the original examples remained. Screenshots: `output/playwright/agent-created.png`, `agent-edited.png`, `agent-deleted.png`.

The first live attempt exposed a real Codex 0.153.4 schema restriction: JSON Schema tuple `items` caused `thread/start` to reject `loops_create`. A separate ephemeral app-server check, with no model turns, reproduced the failure and accepted the tuple-free projection. Only the tool-facing schema projects Repeat's tuple as a bounded item union; server parsing still enforces Inference followed by Condition. The regression test rejects reversed bodies through the actual SDK adapter.

Evidence is under `evidence/agent-authoring/`: `verification.json` contains assertions, successful native terminal receipts and executable hashes; `chat-history.json` contains only this dedicated test chat; `after-create.json`, `after-edit.json`, `after-delete.json` record the temporary definition; `checks.log`, `package-tests.json`, installed metadata and effective tool inventories record the package/runtime checks. Schema-diagnosis files are labeled separately and are not successful agent execution evidence. Documentation-only repacking leaves the verified executable hashes unchanged.

## 0.1.0 execution and graphical baseline — September 9, 2026

Verified September 9, 2026 with released **OpenClaw 2026.9.3 (1391f7c)**, **Node 24.16.0**, **Ollama 0.32.15**, and **qwen3.5:4b**. The external plugin is installed in this project's isolated profile. Gateway: `http://127.0.0.1:19491`; separate model server: `127.0.0.1:11439`. The model uses a 16,384-token context, one inference at a time and approximately 3.4 GB of loaded model memory on the 16 GB Mac. Model memory is not total system usage.

The source handoff and `docs/HANDOFF.md` have identical SHA-256 hashes. EmbodySense and the personal assistant instance remain unchanged. This verifies the scoped local POC, not full EmbodySense axiom compliance or host-wide governance.

## Automated and package checks

`npm run check` passed typecheck, lint, **39 focused tests**, backend bundling and the host's native UI build. `node scripts/verify-package.mjs` packed the external plugin, extracted it and passed **10 adapter tests against that packaged backend and released SDK**. Those ten are the adapter subset of the 39, rerun against the tarball. Automated model transports are explicitly deterministic fakes; live proof below uses Ollama.

Tests cover strict definitions/imports/inputs, safe bindings and predecessor validation, branching, Repeat early exit/exhaustion, failures, structured model output, revision conflicts and pinning, request deduplication/conflicts, limits, cancellation, Wait persistence/restart and interrupted calls. Authorization cases include disabled/disallowed loops, forged ownership, agent publishing and review denial, review bypass, and permissions revoked before resume/action. Adapter tests exercise command/tool registration, separate registration scopes sharing the service, compact receipts, full UI inspection, trusted repeated calls and pending/failed states. Slow work returns a running handle after ten seconds while the service retains execution ownership; its test verifies later completion without duplicate dispatch.

Evidence beside the source: `evidence/checks.log`, `evidence/package-tests.json`, `evidence/package.json`, `evidence/installed-plugin.json`, `evidence/backend-identity.json`, `evidence/artifact-hashes.json` and `evidence/launch.json`. Runtime hashes bind the live proof to the final installed backend and browser asset. Documentation-only repacking does not change those executable hashes. Evidence is intentionally outside the installable tarball.

## Real user command and agent tool

The **Loops live demo** conversation invoked **summarize-text revision 1** twice, with identical pinned definitions, supplied input and trusted conversation identity:

| Source | Real loop run | Outcome |
|---|---|---|
| User `/loops run` | `05e28597-6cf2-4b58-beb3-03e43d2a84ef` | Completed; summary returned directly to chat |
| Chat agent's `loops_run` | `f052784e-5bef-4a92-925c-566b46fc23c8` | Completed; actual result and run ID in the final assistant reply |

Both used the shared Engine and OpenClaw's real `isolated-agent-runtime` completion, with audit caller `loops-poc`, purpose `loops-poc.inference`, provider/model and token usage recorded. The agent initially tried an unloaded direct tool name, then recovered through the host's supported `tool_search` and `tool_call` surfaces. It listed the three enabled loops, chose the summary loop and actually invoked it. That recovery remains visible in the transcript. Its final model turn used 15,214 total tokens within the 16K context; normal host compaction then completed. There is no replacement chat harness or context engine.

Evidence: `evidence/CHAT-DEMO.md`, `evidence/chat-transcript.json`, `evidence/user-and-agent-runs.json`, `evidence/ollama-runtime.json`. Earlier successful first-slice records remain in `evidence/first-user-and-agent-runs.json` and `evidence/workflow-chat-transcript.json`.

## Host action and durable Continue

**read-pause-continue revision 1**, run `4ce15bd1-f884-4be0-bcca-e2d4c755dce7`, called OpenClaw's public configured-model resolver and recorded `{provider:"ollama", model:"qwen3.5:4b", agentId:"main"}`. It parked at Wait. After the isolated Gateway stopped and restarted, the native UI selected the same run and explicitly continued it through real Inference and Return. Assertions verified the same owner and pinned definition, identical original Action output/trace, exactly one Action execution and five total node executions.

Evidence: `evidence/final-parked-before-restart.json`, `evidence/final-resumed-after-restart.json`, and `output/playwright/final-parked.png`, `final-restored.png`, `final-resumed.png`. The earlier independent restart proof is also retained.

## Review, revision pinning and graphical acceptance

- **Early success / Reject:** run `1ba6ca32-84d6-4601-9cbb-b24e0c4cf3f7` met the phrase condition after one real inference. Its human-review checkpoint survived relaunch. A real `/loops resume` attempt was denied because Continue cannot approve review. UI Reject recorded the human decision and followed Fail without dispatching Return.
- **Exhaustion / Approve:** run `bc737449-5786-4c05-8c76-1e3d8af33460` made exactly three real inference attempts against a deliberately unreachable condition. It recorded `succeeded:false`, `exhausted:true`, then parked for review. The browser saved and enabled revision 3 with the original phrase condition restored. Approving the existing revision-2 run returned its stored proposal and preserved its original definition.
- **Import / edit / cancel / export:** the browser imported the shipped summary definition with a fresh disabled identity, edited its label/prompt, added and moved Wait, connected and edited edges, saved and enabled **browser-checkpoint revision 2**, then ran it with the real model. Cancel at Wait produced run `83fb1bf6-101e-4694-b079-e7422b0e1dce`, with no Return execution. Its downloaded JSON passes the server parser/validator and contains no grants, run records or credentials.
- **Create / remove / reconnect:** the browser loaded an example as a disabled draft, created a two-node loop, added/removed a node, removed/reconnected an edge, used zoom/fit and pointer pan, then saved/enabled/ran **authoring-smoke**. `<b>Plain text</b>` remained escaped text, with no rendered HTML element. Both QA loops were disabled afterward; the three starter loops remain enabled.
- **Canvas / layout:** a measured-node regression and clipped minimap were fixed and rechecked against the final installed asset. Nodes remain visible after switching loops and selecting them; the minimap uses its actual 100×68 dimensions. The 1100-pixel desktop layout had no horizontal document overflow. Final screenshots show the actual native page and real run evidence.

Evidence: `evidence/repeat-early-success.json`, `review-resume-denied-chat.json`, `review-rejected.json`, `repeat-exhaustion.json`, `repeat-approved-pinned.json`, `browser-cancelled.json`, `browser-authoring.json`, plus screenshots and accessibility snapshots under `output/playwright/`. `evidence/browser-acceptance.json` records final canvas/layout observations.

## Practical limits

This is a local, single-operator/main-agent POC using experimental external-plugin APIs. Inference and configured-model metadata are host-backed; other node mechanics and authenticated human review are plugin logic. Web search is visibly unavailable. Wait/review are manual; active calls interrupted by shutdown are inspectable and never automatically replayed. Deduplication is limited to retained records. Read `CAPABILITIES.md` for the exact limits and trust boundaries, and `README.md` for setup, launch, uninstall and the try-it sequence.

`evidence/diagnostics/` retains earlier unsuccessful integration experiments, including the offline LM Studio reference, an unsuitable thinking model, the host's separate tool registration scope and excessive chat receipts. They are not acceptance evidence. The user explicitly selected Ollama and authorized installing a model that fits this machine.
