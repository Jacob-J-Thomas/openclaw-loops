# Local verification

## Alpha.18 OpenClaw 2026.9.5 SDK adoption

Bolt #186 pins the source, peer, build compatibility metadata and generated manifest to released OpenClaw 2026.9.5. Its compile-only public consumers accept optional `responseModel` and `stopReason`, retain the isolated request's temperature/output-token/reasoning surface, and exclude the release's direct-provider-only `responseFormat` and `requiredAuthMode` controls from that isolated branch. They also name the additive configured runtime-policy reader and persisted asynchronous task resolver while retaining the existing synchronous owner-bound cancellation contract.

These consumers make no runtime, provider, Gateway, delivery or cancellation call. Source and extracted-package checks qualify the public type/package boundary only. The exact alpha.18 archive, ordinary unmodified-host installation, matched lifecycle, native command/tool/UI readback, actual selected-model routes and hosted macOS/Linux × Node matrix require separate candidate receipts before this host pin is accepted.

## Selected-model invocation parity

Qualify the same saved definition and revision through the native editor, a real
`/loops` command, and an actual agent `loops_run` invocation for both Codex and
Ollama. Use dedicated conversations, select their model and reasoning through
OpenClaw, and leave the inference node's settings inherited. Keep local inference
serial. Retain the installed archive hash, runtime hashes, public session-selection
responses, complete `loops_inspect` records, native UI action/screenshot evidence,
and public `chat.history` results. A `session-action` record alone does not prove
that someone clicked the editor's Run button.

`scripts/model-parity-evidence.mjs` exports `verifyModelParityCase` and
`verifyModelParityMatrix`. A case contains `surface` (`session-action`, `command`,
or `tool`),
the full public `run`, and independently recorded `expected` values: `model`,
`runtimeOwner`, `agentId`, `sessionKey`, `sessionId`, `definitionId`, `revision`,
`nodeId`, `reasoning`, and exact `input`. Tool cases also require the original
`requestId` and the public `history` response. The matrix requires six distinct
runs of one revision, covering all three surfaces for Codex/OpenAI and
OpenClaw/Ollama. It compares pinned settings with actual inference output
attribution and matches the assistant's tool arguments to the corresponding
successful tool result. A model's prose, a mismatched transcript, a failed run,
or a result from another model cannot qualify a case.

All six cases must check the same inference node. That checked node must inherit
both model and reasoning: a present `model` or `reasoning` field is rejected,
even when it matches the selected conversation. Unrelated `advanced` settings
remain part of the saved graph and are not treated as a model/reasoning override.

This pure record verifier qualifies public backend-route model attribution only.
Its `session-action` result is not a UI claim and its receipt explicitly marks
native editor proof `unverified-separate`. Do not pass a caller-asserted browser
object to upgrade that scope. Independent native editor acceptance requires the
retained actual Playwright Run-button action plus before/after page capture,
reviewed separately from this record matrix.

Run the verifier against a locally captured case array without publishing raw
transcripts or account identifiers:

```sh
node --input-type=module -e '
  import {readFileSync} from "node:fs";
  import {verifyModelParityMatrix} from "./scripts/model-parity-evidence.mjs";
  console.log(JSON.stringify(verifyModelParityMatrix(
    JSON.parse(readFileSync(process.argv[1], "utf8"))), null, 2));
' evidence/model-parity-cases.json
```

The focused synthetic rejection tests run in the normal Vitest suite. They verify
the evidence checker; they are separate from the real runtime and browser receipts.
Neither the checker nor a successful completion establishes the applied reasoning
level or effective credential owner: OpenClaw 2026.9.3 does not return those
attestations, so they remain `unknown`.

Account policy matters on this host release. After OpenClaw binds an account to a
conversation, Loops preserves that selection as `execution.authProfileId`. Isolated
completion requires the operator's explicit
`plugins.entries.loops-poc.llm.allowAuthProfileOverride: true` grant. Merge that
setting into the selected test profile only when that authority is intended;
preserve existing policy. Loops must not grant it automatically, remove the account
selection, or choose another account to avoid a denial. A direct command can use
the host's invocation-bound completer, while tool and UI contexts lack that same
capability. Default account inheritance and effective-account attestation remain
[SDK02 requirements](UPSTREAM_REQUIREMENTS.md#required-plugin-facing-contracts).

The September 14, 2026 native qualification used OpenClaw 2026.9.3, Node 24.16.0,
source `d5d6fc2d37910e1fac56af5c0ef436c5aeebcebc`, and the ordinarily installed
archive SHA-256 `a00ae0a9bbbac1e5d30d0af0034bf39ab5425b677744bbd0a6126c99b008c527`.
All six runs completed on saved revision 1:

| Selected target | Requested reasoning | Native UI run | Command run | Agent tool run |
|---|---|---|---|---|
| `openai/gpt-5.6-sol`, Codex harness | `low` | `137f2adb` | `17cbaf01` | `c7517b8c` |
| `ollama/qwen3.5:4b`, OpenClaw harness | `off` | `e1edf081` | `8fd841e2` | `5dd0841a` |

Run identifiers above are abbreviated synthetic evidence references. The Codex
command succeeded before the account grant; the first real agent invocation was
correctly retained as a failed `HOST_POLICY_DENIED` case. After the explicit grant
and test Gateway restart, a fresh agent invocation and the native UI invocation
completed with the requested account binding preserved. The earlier denial is
not counted as a passing run. Both model families returned their actual provider,
model, agent, and runtime owner. These observations qualify model/runtime selection
and requested reasoning in this environment, not two-account isolation, applied
reasoning, or complete SDK02 acceptance. The evidence-verifier change does not
alter the plugin runtime.

## Mounted Editor Advanced lifecycle

After `npm ci` and `npx playwright-core install chromium`, `node scripts/verify-editor.mjs` bundles and mounts the production `Editor` in headless Chromium, drives the visible DOM controls, and writes a synthetic-transport receipt. It checks inherited/explicit zero behavior, single and all Advanced resets, model change, published revision preservation through restore, clone, export, and import. The fixture transports editor requests only; it does not invoke an OpenClaw Gateway or provider. CI runs it once on Linux / Node 24.16.0 after installing Chromium.

## Responsive text and host themes

The responsive-layout check uses the permitted 100-character loop name, node label and input display label, plus a 500-character description, including unbroken text. Reload the saved draft and inspect authoring, run inputs, an existing structured failure and a complete oversized result at 320, 390, 900, 1024 and 1440 pixels. Headings, labels and run panels must stay inside their containers; library and graph scrolling remain intentional. Native text inputs may scroll their values internally.

Use the host's Light and Dark controls with the opposite system preference, then verify that System follows both preferences. Measure rendered text and keyboard focus colors in each resolved scheme, inspect screenshots after transitions settle, and capture console errors. Record the installed package hash and source commit with the receipt. Temporary injected styles are useful for diagnosis but do not qualify the installed artifact. These sampled checks do not establish complete WCAG conformance or screen-reader speech acceptance.

Current scope is the [standalone 1.0 delivery plan](DELIVERY_PLAN.md), revised September 12, 2026. Expansion families are deferred. Public GitHub source/history publication is now authorized; references to pending authorization in older entries describe their historical checkpoint and no longer apply. The [current status](DELIVERY_STATUS.md) records publication and release gates separately.

## Alpha.17 transport storage hardening

This independent plugin change uses the existing OpenClaw **2026.9.3** API. It does not require an upstream contribution. The full **181 source tests**, typecheck, lint and build pass on macOS arm64 / Node **24.16.0**. Package and hosted platform results are separate gates; consult the exact commit's [Verify plugin run](https://github.com/Jacob-J-Thomas/openclaw-loops/actions/workflows/verify.yml).

Seven new storage regression cases reproduce partial disk-full writes, a failed completion-marker rename after a snapshot committed, access/I/O read failures, malformed JSON and record shapes, reuse of a corrupt snapshot, and invalid final JSON. Failed writes preserve committed staging, remove their own temporary file when possible, and allow explicit recovery. Corrupt files stay available for diagnosis. These injected filesystem failures are deterministic evidence, not power-loss or physical-media qualification.

Three new actual public SDK adapter journeys cover inaccessible transport storage, corruption between result pages and upload conflicts. UI, commands and agent tools retain the same safe error/recovery data. The UI stops before submitting an operation whose upload failed and does not return partial content after a page failure. The adapter fixtures use real temporary files and the published OpenClaw SDK with a fake model transport; no model call occurs in these failure journeys.

The Linux-only filesystem-full script now also rejects uploads and snapshots on an actual full, dedicated 16 MiB tmpfs, verifies committed files and readable existing results, checks failed temporary-file cleanup, and completes an identical explicit upload retry after freeing space and reopening storage. Adding the script is not a passing Linux result; hosted CI reports its execution for each exact commit. Existing alpha.16 live model/browser receipts below remain tied to their original installed artifact.

## Alpha.16 editor Undo and draft recovery

At this checkpoint, both isolated Gateways ran **1.0.0-alpha.16** on OpenClaw **2026.9.3**. Installed backend, worker, native UI and manifest matched archive SHA-256 `df5b31c0569e999252542060847f53be42ba14767f59d839aa7c1a7ba0f5f4ee`. This documentation update followed packaging and is separate from executable identity. Evidence is under `evidence/release-alpha16/`.

The preceding browser check reproduced an authoring defect: Reset followed by Undo restored the two saved Advanced overrides but left the editor marked dirty, Run disabled, and an obsolete local recovery draft. The editor now derives unsaved changes from the current definition and its saved base, ignoring JSON object-key ordering while preserving explicit zero. Undo to the base removes only the recovery snapshot last written by that editor; an existing or newer snapshot from another view stays recoverable. New definitions still have unsaved changes. This is optimistic browser draft preservation, not an atomic multi-tab collaboration protocol.

Three regressions cover structural equality, Reset/Undo/Redo draft synchronization, and preservation of other drafts. The full **171 source tests** pass on macOS arm64 and Linux arm64 with Node **24.16.0/26.1.0**. Types, lint, build and **31 extracted-package SDK tests** pass; all five compiled/metadata files match across platforms. The macOS Node 24 receipt is an explicitly labeled transcription of the completed `npm run check` output; the other test receipts are native Vitest JSON. Both Linux containers had no network or host mounts, exited 0 without OOM, and passed the actual 16 MB tmpfs-full failure/recovery check. The task VM is stopped.

The native UI verified **Reset → Undo → Redo → Undo**. Reset/Redo unset the controls, created the local draft and disabled Run. Undo restored temperature `0` and output tokens `128`, disabled Save draft, removed the temporary local draft and re-enabled Run. The subsequent UI invocation `b58e0e8c-f7bc-417c-8463-126ae186d610` completed through real Codex inference with `UI inference verified.` at the unchanged saved revision 1. Reload completed without an unsaved-navigation dialog. The test tab recorded zero console errors; reload emitted six host-asset preload warnings. Screenshots and snapshots are under `output/playwright/alpha16-*`. The earlier test-only obsolete snapshot was explicitly discarded; no published definition or unrelated browser draft was edited.

Fresh independent command/tool smoke tests used the same saved enabled revision 1:

| Profile | User command | Agent tool | Outcome |
|---|---|---|---|
| Codex, Sol selected only in the synthetic conversation | `c8164674-ac47-4507-ad94-bf8a7791bf44` | `511f8425-f73c-451c-aa7f-e71b80692763` | Completed; exact fresh input and agent-reported new run ID verified. |
| Separate Ollama server, `qwen3.5:4b` | `ed07d6d8-b070-4238-b909-7f9d0479afbc` | `39fe9c9d-2b02-411d-bc1f-fe244f1a0aba` | Completed; exact fresh input and agent-reported new run ID verified. |

The stopped-state backup is `.dev-profile/backups/before-alpha16-1789237646635`. Every application-table row stayed identical through upgrade: **13 definitions / 165 runs** for Codex and **8 definitions / 58 runs** for Ollama. After acceptance, all original rows remain identical, both configurations remain deeply equal, and the only added run records are the five synthetic invocations above. The backend and worker are byte-identical to alpha.15, whose broader 65-command lifecycle journeys remain separately recorded. This is a verified local alpha; public release, host authority integration and the remaining release/expansion requirements are incomplete.

## Alpha.15 indexed history and memory

At this checkpoint, both isolated Gateways ran **1.0.0-alpha.15** on OpenClaw **2026.9.3**. Installed backend, worker, native UI and manifest matched archive SHA-256 `747c13f808151d59864a4a27cf1653764cfffd14517a16bd703ea16a22ee9d12`. This documentation update followed packaging and is separate from executable identity. Evidence is under `evidence/release-alpha15/`.

The engine now retains only unfinished execution and cleanup records. Historical and parked runs load individually through authorized SQLite queries; history pages use the owner/time index. Authoring transactions merge the working set without rewriting or deleting omitted cold history. Explicit retention reads compact identity/recovery metadata and transactionally removes its selected rows while preserving immutable admission tombstones. Legacy revisions missing from old mutable definitions are recovered without loading complete historical outputs. Database schema remains 2 and saved record formats are unchanged.

Seven new regressions cover startup/pagination without full-state reads, owner-scoped inspection, exact cold-record preservation through authoring, parked wait/review reload and pinned versions, restart uncertainty, physical cancellation accounting, held-object rollback, and rejection of corrupt cold/retention metadata. The full **168 source tests** pass on macOS arm64 and Linux arm64 with Node **24.16.0/26.1.0**, together with types, lint, build and **31 extracted-package actual SDK tests**. All five compiled/metadata files match across platforms. Both Linux containers had no network or host mounts, exited 0 and had no OOM. Actual 16 MB tmpfs exhaustion returned `LOOPS_STORAGE_FULL` before a host effect, preserved committed state, then recovered with one explicit effect and `integrity_check=ok`. The 2 GB test VM is stopped.

A separate benchmark compared alpha.14 commit `2e7f6dd839a9ad1f45a7bb66962c402d47c2cd2b` with the final alpha.15 source. Separate Node 24 processes opened identical stopped SQLite snapshots containing 1,000 synthetic runs. With explicit garbage collection, main heap after opening was **99,969,776 bytes before / 7,073,928 after**; after 12 deterministic runs, **100,608,592 / 7,538,320 bytes**. Startup was **988 / 324 ms**, and a 50-row history query **8.7 / 3.8 ms**. Both returned the same complete output hash and passed integrity checks. This does not prove faster inference, peak-memory limits or general production capacity. Definitions/revisions and active runs still require memory, full inspection loads one run, retention scans compact metadata and commits remain synchronous. Evidence: `evidence/history-loading/memory-comparison.json`.

The stopped-state backup is `.dev-profile/backups/before-alpha15-1789234595062`. Every application-table row stayed identical through upgrade: **12 definitions / 150 runs** for Codex and **7 definitions / 45 runs** for Ollama. Later acceptance added only synthetic definitions/runs; it did not alter personal profiles or model-server configuration.

Fresh independent invocation smoke tests used the same saved enabled revision 1:

| Profile | User command | Agent tool | Outcome |
|---|---|---|---|
| Codex, Sol selected only in the synthetic conversation | `4fe17bf1-1408-45e1-8273-4ecd3f486864` | `ee31718a-e180-438c-90e0-3d28a75022d9` | Completed; exact fresh input and agent-reported new run ID verified. |
| Separate Ollama server, `qwen3.5:4b` | `145b7932-5dc2-4a10-9ee5-666d6140a588` | `dc9d8352-ad86-4cb9-a1a6-cdec8f03dd2f` | Completed; exact fresh input and agent-reported new run ID verified. |

Separate **65-command lifecycle journeys on each Gateway** exercise enabled authoring, draft/publication/version operations, unpublished tests, cold wait/review continuation, cancellation/recovery ancestry, deletion, retry identity and fully retrieved 50,000-byte Unicode input/output. Their final real inference runs are Codex `dfbf1a49-fc37-42ae-8f01-e52dc0c92df5` and Ollama `e2397c32-e453-4d80-a380-527fdc370dc5`. The initial Codex smoke and command journey used the same evidence directory; those files are retained under `commands/codex/`, and the smoke was rerun into its own directory with a fresh session before final assertions.

Fresh native UI inspection paged through **103 existing synthetic runs** and loaded the oldest retained run `a2959d93-f8f5-4daf-9dce-a963ab848c5e`, including its complete result and both steps. Switching to the new acceptance conversation reset history to its two runs; the inspector displayed agent run `ee31718a-e180-438c-90e0-3d28a75022d9` and its actual result. The saved synthetic inference node still showed temperature `0` and output tokens `128` under Advanced, with advisory/unsupported explanations and no unsaved edits. The fresh tab reported zero console errors/warnings. Screenshots and accessibility snapshots are under `output/playwright/alpha15-*`. This proves the exercised browser paths; it does not establish the remaining screen-reader, browser/device or deployment-role matrix.

ClawHub 0.23.3 static validation of the exact extracted installed archive passed with zero findings and target OpenClaw **2026.9.3** available. An earlier relative local-path attempt returned a missing target and was retained separately; it is not host-compatibility evidence. Static validation does not prove registry acceptance, publisher identity or publication.

A source-aligned publication candidate at `0ac84bb3523ab25e2ca280db929b9bf3ecc4984f`, archive SHA-256 `bc8816eeb229e0ef815819f5eeadd4c82306062d729b50b4aebefa5e546c7233`, passed 31 extracted-package tests and the ClawHub code-plugin publication dry run with explicit source commit/ref/path. All five compiled/metadata files match the installed alpha.15 package; seven documentation files differ. The dry run neither authenticated nor uploaded, and the referenced public source does not yet exist. It does not prove namespace ownership or registry acceptance.

SDK01 native Ollama sampling now has a separately reviewed local commit and canonical API comparison, described in [UPSTREAM_REQUIREMENTS.md](UPSTREAM_REQUIREMENTS.md). It remains uninstalled and unpublished. Public source/CI/registry acceptance, host authority/account/delivery integration and the rest of the release/expansion plan remain open.

## Alpha.14 conversation-command parity

At this checkpoint, both isolated Gateways ran **1.0.0-alpha.14** on OpenClaw **2026.9.3**. Installed backend, worker, native UI and manifest matched archive SHA-256 `87d9960c2a1dab4d2713036c55fc248a4763b8160702a869bf7f460595b72a18`. This evidence update followed packaging and is separate from executable identity. Evidence is under `evidence/release-alpha14/`.

All 33 shared operations now accept the conversation form `/loops <operation> <JSON object>`, with schema-derived help, the existing text shortcuts, structured failures, staged input and complete result retrieval. Commands use the same validation and backend handlers as UI actions and agent tools. Authenticated command write authority permits enabled authoring and lifecycle control; Human review retains its explicit human decision requirement. The 31 agent tools remain available.

The actual host truncates inline command arguments at 4,096 UTF-16 units. Loops now detects changed arguments and rejects them before executing, with `HOST_COMMAND_INPUT_CHANGED` and a chunked-upload recovery path. A dedicated acceptance journey sent **65 real chat commands on each Gateway**. It covered enabled creation, UI read parity, drafts that preserve publication, publication/version restoration, conflicts, unpublished tests, wait/resume, cancellation/recovery, approve/reject, archive/recovery/deletion, fresh admission IDs, explicit retry deduplication, and a fully retrieved **50,000-byte Unicode result** from staged input. Its final completion used the selected real model: Codex run `a00e84d3-d4d3-47d0-be45-f3de26266019` and Ollama run `6b60b490-93ff-4ff7-b634-a332d334df4f`.

The first Codex test client tried to parse OpenClaw's truncated display preview as full JSON. Evidence is retained under `commands/codex-attempt1-preview-client/`. The client now follows the exact transcript message identity through authorized `chat.message.get`; the full committed result was present. Its temporary definition was archived through the normal API. The subsequent complete journeys passed, without weakening plugin budgets or replaying a command to retrieve its output.

Fresh independent invocation smoke tests used the same saved enabled revision 1:

| Profile | User command | Agent tool | Outcome |
|---|---|---|---|
| Codex, Sol selected only in its synthetic conversation | `3aa2eb55-9fe7-42dd-b701-730c147e31ba` | `da0a5d72-ed29-4560-ba33-2bb69cd47004` | Completed; exact fresh input and agent-reported new run ID verified. |
| Separate Ollama server, `qwen3.5:4b` | `c8b46d24-3c63-4776-8e31-3f0c490a7dd6` | `d7478500-66cd-4d37-9c26-455ecfb7d21e` | Completed; exact fresh input and agent-reported new run ID verified. |

**161 source tests** pass on macOS arm64 and Linux arm64 with Node **24.16.0/26.1.0**, together with types, lint, build and **31 extracted-package actual SDK tests**. All five compiled/metadata files match across platforms. Linux rebuilt current source using the earlier verified dependency images; the entire dependency lock was checked equal apart from this package's own version. Both test containers had no network or host mounts, exited 0 and had no OOM. Real 16 MB tmpfs exhaustion returned `LOOPS_STORAGE_FULL` before a host effect, preserved committed state, and recovered with exactly one explicit new invocation and `integrity_check=ok`. The task-only 2 GB VM was stopped after collection.

The stopped-state backup is `.dev-profile/backups/before-alpha14-1789231333235`. Every application-table row stayed unchanged through installation and restart: Codex 10 definitions/133 runs, Ollama 6 definitions/32 runs. Later acceptance added only its synthetic definitions and runs. No personal-profile or model-server settings changed. This remains a local alpha; identity/account SDK dependencies, public CI/registry installation and the remaining release and expansion gates are open.

## Alpha.13 shared node contracts and worker memory

At this checkpoint, both isolated Gateways ran **1.0.0-alpha.13** on OpenClaw **2026.9.3**. Tarball SHA-256: `f160c6e6c1062204d79a54d56bb1f5511263ae0ac29241db772ceb96328125f3`. Installed backend, worker, UI and manifest matched the archive. This evidence update followed packaging and is separate from executable identity. Evidence is under `evidence/release-alpha13/`.

The internal node registry now supplies the schemas, binding inputs, producer outputs, capability declarations, exit ports, execution and editor defaults for all nine current kinds. The complete definition schema matches commit `8feee20` byte for byte (SHA-256 `02990425c54289c384d33e54ddd7cfe8648138122971ca90d72ce2a5eace1020`). Existing version 1/2 definitions retain their contract. A registry-authored combined workflow executes six Repeat iterations, forwards explicit temperature zero, survives a parked restart, rejects agent approval, and reaches both human-approved Return and human-rejected Fail outcomes. Native browser inspection verifies the palette, model-action inspector and Advanced controls without editing saved definitions or local drafts.

SQLite checkpoints now compare against committed rows without retaining a second history copy in the worker. A separate 1,000-run synthetic fixture measured settled worker heap after a V8 heap snapshot at **98,298,752 bytes before** and **5,541,136 bytes after**, with exact output retrieval and integrity checks. The process-level benchmark did not show a reliable peak RSS reduction, and the main engine still loads complete history. Worker memory improvement is not a whole-application capacity guarantee. Private measurement sources and receipts are under `evidence/storage-worker/` and `.dev-profile/measure-worker-memory.mjs`.

**155 source tests** pass on macOS arm64 and local Linux arm64 with Node **24.16.0/26.1.0**. Types, lint, build and **25 extracted-package SDK tests** pass. All five compiled/metadata files match across platforms. Both Linux test containers had no network or host mounts, exited 0 and had no OOM. Real 16 MB tmpfs exhaustion rejected admission before any host effect, preserved committed state, and recovered with one explicit new invocation and `integrity_check=ok`. The 2 GB validation VM was stopped before live inference.

The stopped-state upgrade backup is `.dev-profile/backups/before-alpha13-1789228534863`. Every application table stayed unchanged through installation and restart: Codex 10 definitions/131 runs, Ollama 6 definitions/30 runs. Subsequent synthetic smoke tests added two runs to each profile. Saved definitions, personal profiles, configured model servers and the default Docker context were unchanged.

| Profile | Fresh user command | Fresh agent tool | Outcome |
|---|---|---|---|
| Codex, Sol selected only in the synthetic conversation | `ba50a4fa-c8b0-40a1-b350-633e779be46f` | `09a0275a-adef-433b-b6a4-4ef8340ad989` | Same enabled revision 1; exact input and newly reported run-ID assertions passed. |
| Separate Ollama server, `qwen3.5:4b` | `6f5b75f1-cfeb-46f6-92ef-f4b67e83c37c` | `5f554d9a-e16c-4906-b255-ac926972f4fe` | Same enabled revision 1; exact input and newly reported run-ID assertions passed. |

This is a verified local alpha, not a 1.0 release. Public CI/registry publication, host identity/account integration, broader deployment/resource acceptance and the later expansion milestones remain open.

ClawHub CLI 0.23.3 static validation of the exact extracted alpha.13 artifact against OpenClaw 2026.9.3 passed with zero issues. A source-aligned candidate at `f759cc7a9bda02c5d7c0d71c318323d821ad8cf7`, SHA-256 `bf191267eacc4108f096eb075663b0130c1e411579465c0a67e6e3594106da38`, also passed the code-plugin publication dry run. Its 19 non-document files match the installed archive; four documentation files differ, and 25 extracted-package tests pass. The dry run did not authenticate or upload, and does not establish namespace ownership, source availability or registry acceptance. Publisher authentication and actual publication remain pending.

## Alpha.12 actionable failure diagnostics

At this checkpoint, both isolated Gateways ran **1.0.0-alpha.12** on OpenClaw **2026.9.3**. Final tarball SHA-256: `1598eb51c95434c32fc18417871cb78dfe42ef3fa36d5d46b892ddd37cf161bc`. Installed backend, worker, native UI and manifest match that archive. Evidence is under `evidence/release-alpha12/`; this documentation update follows packaging and is separate from executable identity.

The source passes **153 tests** on macOS arm64 Node **24.16.0/26.1.0** and local Debian Linux arm64 with the same versions. Typecheck, lint, build and **25 extracted-package tests through the actual feature SDK** pass. All compiled files, manifest and package metadata match across platforms. Both Linux containers used no network or host mounts, exited 0 and had no OOM. The 2 GB validation VM is stopped; the pre-existing default VM and Docker context are unchanged. The Mac UI-only follow-up reused the unchanged backend/worker test evidence and passed fresh type/lint/build/package checks plus native browser verification.

Actual SQLite failures now produce typed storage codes. The Linux tests filled a dedicated 16 MB tmpfs to `ENOSPC`: admission rejected with `LOOPS_STORAGE_FULL`, no host effect occurred, and committed data stayed exact. After freeing space and reopening, a fresh explicit request completed with one host call and `integrity_check=ok`. Worker/process regressions also preserve the original rollback and crash-recovery contracts.

Wrapped provider failures are classified into safe diagnostics, retaining the failed node and its selected model while discarding raw host URL, credential and request-body text from results and persisted run history. The actual feature SDK tests verify those properties across tool, command and UI operations. Deliberate graph failure messages remain available. Unknown host errors stay generic; these checks do not establish complete provider/account coverage.

A live unpublished test selected an intentionally nonexistent model. Run `3d3fc148-fdd8-4780-aa23-a3a289cd9665` failed with `HOST_UNAVAILABLE`, phase `inference`, node `infer`, the selected synthetic model and recovery guidance. Browser inspection first reproduced missing diagnostic details, then verified the repaired error panel at the normal narrow viewport. The final UI shows code, phase, node/model, retryability and recovery; Advanced controls remain available with the released SDK's advisory/unsupported explanations. Before/after screenshots are under `ui/`.

Fresh invocation evidence:

| Profile | User command | Agent tool | Outcome |
|---|---|---|---|
| Codex, Sol selected only for its synthetic conversation | `286e93d0-d36e-4af3-a939-d2c4d418494c` | `012530ba-f5ec-4f59-87b9-256361417699` | Completed the same enabled revision 1; exact input and newly reported run-ID assertions passed. |
| Separate Ollama server, `qwen3.5:4b` | `cb547722-c09e-4419-be11-e9b30841cff3` | `0a4eb37d-663a-4f0a-a9f5-ef6d4dd565b9` | Completed the same enabled revision 1; exact input and newly reported run-ID assertions passed. |

The initial alpha.12 upgrade preserved every table with Codex at 10 definitions/128 runs and Ollama at 6 definitions/28 runs. The UI follow-up also preserved every table, including the three new Codex verification runs: 10 definitions/131 runs and 6 definitions/28 runs. Its stopped-state backup is `.dev-profile/backups/before-alpha12-1789197049417`; the initial artifact and receipts are retained in `before-ui-repair/`. Backend and worker hashes were unchanged by that UI follow-up. Ollama smoke tests subsequently added two runs. Personal profiles, model-server settings and saved loop definitions were unchanged.

SDK01 sampling and native reasoning repairs are separately reviewed local upstream commits, described in [UPSTREAM_REQUIREMENTS.md](UPSTREAM_REQUIREMENTS.md). Neither is installed, submitted or released. Hosted CI, registry publication, deployment-role/native provider evidence and the remaining release/expansion requirements remain open.

## Alpha.11 checkpoint performance and platform verification

At this checkpoint, both isolated Gateways ran **1.0.0-alpha.11** on OpenClaw **2026.9.3**. Tarball SHA-256: `fa9fc49a46d1e77dd74aa1598c160b95d9de086c271ff47a0e719e9411dc8d6c`. The installed backend, worker, native UI and manifest matched the archive. This documentation update followed packaging and is separate from executable identity. Evidence: `evidence/release-alpha11/`.

The source passes **143 tests** on each of macOS arm64 Node **24.16.0/26.1.0** and a local Debian Linux arm64 VM with the same Node versions. Typecheck, lint, build and **23 extracted-package tests through the actual feature SDK** also pass. Every compiled package file, package metadata and the manifest match across macOS and both Linux builds. Linux test containers had networking disabled, no host mounts, no OOM and exit code 0. The temporary 2 GB validation VM is stopped; the existing default VM and Docker context are unchanged. This does not establish native x64, hosted CI, team-role or complete deployment acceptance.

Execution checkpoints now transmit and transactionally update only their changed run. Authoring, migration, startup and explicit retention retain coordinated whole-state commits. Actual worker tests verify retained history, attempts, outputs, admission identity, rollback and exact reopen state; the engine crash fixture exercises the new checkpoint path. A twelve-execution deterministic benchmark with 1,000 retained runs (90.6 MB serialized state) measured mean execution time **884 ms before / 2.6 ms after**, p95 **957 ms / 4.9 ms**, and observed RSS **3.3 GB / 1.3 GB**. Startup remained about **336 ms**, because complete history is still loaded. These measurements isolate local execution/storage, not model latency or production capacity; lazy history loading and asynchronous commit barriers remain open.

A separate real-filesystem fault test filled a disposable **16 MB Linux tmpfs** until `ENOSPC` on both Node versions. Admission then rejected with no host call, and committed data remained exact. After freeing space, close/reopen preserved the store and a fresh explicit request completed with exactly one host effect and `integrity_check=ok`. The script rejects non-Linux, non-tmpfs, nonempty or larger fault volumes; no host filesystem was filled. The corresponding Linux CI step is configured but has not run in hosted CI. The error currently lacks a stable structured storage code, which remains R05 work. APFS exhaustion, power loss and provider physical cancellation are separate unproven cases.

The stopped-state backup is `.dev-profile/backups/before-alpha11-1789193033975`. Hashes of every application table stayed unchanged through upgrade: Codex had **10 definitions / 126 runs**, Ollama **6 definitions / 26 runs**, both at schema 2 with integrity checks passing. Fresh smoke tests subsequently added two runs per profile. Neither model-server nor personal-profile configuration changed.

| Profile | User command | Agent tool | Outcome |
|---|---|---|---|
| Codex, Sol selected only for the synthetic conversation | `aefa47d9-6d92-434a-9e4f-0d35ffd6c749` | `a80217a4-8b29-4f2f-b246-9dbea94623e7` | Completed on the same enabled revision 1; exact fresh input and reported run-ID assertions passed. |
| Separate Ollama server, `qwen3.5:4b` | `ac12bf4d-087e-451e-ba1b-abb033bc96aa` | `55c0a6ca-1f25-4d79-a0f9-063843a73170` | Completed on the same enabled revision 1; exact fresh input and reported run-ID assertions passed. |

Native UI inspection confirms the new completed Codex agent run and its result. Advanced controls show inherited settings and the released API's advisory/unsupported explanations; the UI executable remains unchanged from alpha.9. SDK01 is still a separately reviewed local upstream candidate, neither installed nor released. In particular, helper-level parameter tests do not establish that a selected provider applies them.

## Alpha.10 storage ownership and crash verification

At this checkpoint, both isolated Gateways ran **1.0.0-alpha.10** on OpenClaw **2026.9.3**. Tarball SHA-256: `a36ff7778f4472c74c25f401e864907c312269e2a8bb39c5e9d6691e1b0068ec`. Every installed executable and the manifest match the archive. The source passed **141 tests** under both Node **24.16.0** and **26.1.0**, plus typecheck, lint and build. The extracted package passed **23 tests through the actual feature SDK**, including service startup/stop failure recovery. Evidence: `evidence/release-alpha10/`. This documentation update follows packaging and is separate from the installed executable identity.

A process fixture reproduced two simultaneous owners reclaiming one stale PID lock in alpha.9. The same interleaving now admits exactly one owner. Alpha.10 holds an exclusive transaction on a stable, empty SQLite lease file until the data worker physically terminates, publishes its PID marker atomically and recovers dead modern markers even after PID reuse. A live legacy marker still prevents startup. Tests also cover failed close, constructor failure, corrupt stored JSON and restart after SIGKILL. Upgrade/rollback must stop the previous Gateway; mixed-version concurrent startup and network filesystems are unsupported.

Twelve engine crash checkpoints exercise admission, pre-inference, in-flight inference, host completion before persistence, committed inference, completion, manual wait/resumption, review/approval, queueing and cancellation while cleanup is pending. Recovery retains committed outputs and explicit uncertainty, does not automatically replay unknown effects, and removes obsolete process-local cleanup state. Separate SQLite subprocess tests prove actual `SQLITE_FULL` using `max_page_count`, preserve the original error after automatic rollback, refuse readback after an unverifiable rollback and distinguish process death before COMMIT from death after COMMIT but before acknowledgement. These are deterministic host fixtures and real SQLite/process faults; they do not prove provider cancellation, filesystem exhaustion, power-loss behavior or the complete deployment/soak matrix.

A stopped-state backup is retained at `.dev-profile/backups/before-alpha10-1789190695576`. Hashes for all application tables remained identical through the upgrade: Codex had **10 definitions and 124 runs**; Ollama had **6 definitions and 24 runs**. Both stores passed integrity checks at schema 2. The new smoke tests subsequently added two runs per profile. No model-server or personal-profile configuration was changed.

Fresh installed acceptance used dedicated synthetic conversations and existing enabled revision 1 definitions:

| Profile | User command | Agent tool | Outcome |
|---|---|---|---|
| Codex, Sol selected for the synthetic conversation | `545ca1b1-8751-40cb-9633-329e0935452b` | `815f3b32-1478-4b40-b0fc-4a4e386b7b90` | Both completed; fresh-input and agent-reported run-ID assertions passed. |
| Separate Ollama server, `qwen3.5:4b` | `dc0ad3b9-4940-4f59-8603-09f4f6836dbd` | `a16aeff5-aa80-470d-ae42-6e71af2098ee` | Both completed; fresh-input and agent-reported run-ID assertions passed. |

The native UI shows the completed Codex agent run and its saved revision. Advanced controls remain visible with inherited defaults and accurate advisory/unsupported labels. The UI executable is unchanged from alpha.9. The proposed upstream sampling-parameter contract remains a local candidate; it is neither released nor installed in these Gateways.

## Alpha.9 theme and Advanced-settings verification

At this checkpoint, both isolated Gateways ran **1.0.0-alpha.9**, tarball SHA-256 `9430a9c85cff87eb1e60aa3443fe9bf0bbc96ca0c947343f17e7ccc2d7581052`. Their backend, worker and native UI hashes matched the artifact. Backend and worker bytes were unchanged from alpha.7. The theme changes passed the full **115-test** source check and build as alpha.8; the final placeholder-only follow-up passed a fresh build and **21 extracted-package SDK tests** as alpha.9. Evidence: `evidence/release-alpha8/` and `evidence/release-alpha9/`.

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
## Sustained public Gateway workload

`node scripts/verify-sustained-workload.mjs <package.tgz>` installs an ordinary plugin archive into a disposable, authenticated Gateway. The default workload runs 256 Input/Return fixtures with 64 KiB Unicode values across four restart epochs, then preserves 16 Wait checkpoints through another restart and explicitly resumes eight and cancels eight. It checks all 272 history IDs, complete input/result hashes, paginated output, document-reference integrity and reader release, terminal execution state, parked-run retention protection, explicit history cleanup and SQLite integrity. A smaller `LOOPS_SUSTAINED_RUNS` value is for diagnosis only; the CI acceptance workload uses the default 256.

The receipt records phase-boundary Gateway RSS, CPU percentage/time, plugin-state bytes, elapsed time and observed response states. These samples can miss intervening peaks; serial deterministic admissions do not measure concurrent queue depth or production inference capacity. Delayed-host queue/cleanup tests and real inference receipts remain separate evidence. Logical history removal does not promise immediate filesystem shrinkage: SQLite allocation and retained transport documents have separate lifetimes. The fixture makes no provider/model calls, uses one disposable Gateway, applies a 15-minute operation budget and waits for child cleanup. The earlier local 256-run qualification completed in about 39 seconds with a largest sampled Gateway RSS of about 710 MiB; this is an observation on one Mac, not a capacity guarantee.

The four-platform Verify matrix runs this journey against its current built archive. Only the sanitized receipt is uploaded. Raw per-record hashes, profiles, credentials and logs remain under ignored `.dev-profile/` paths; successful disposable profiles are removed.


## Post-landing whole-plugin QA, September 20, 2026

QA74 started after PRs #171 and #157 landed and a live readback found no open PRs. Runtime source: main `55625d76087094a095bf5da9b7443d71cfe0cd77`, tree `c5e509fe59180e2eab46f0ba6aea7d387882ef91`. The exercised source checkout at `888d981df4e348be549a7fe9b72af02ba892cb85` has the same tree. The ordinary installed alpha.17 archive SHA-256 is `9c6a38c4a6404f041e708ac9e8314fddc184008930f8a8a67f968b6163d2688f`; 27 installed files were compared. Host: unmodified OpenClaw 2026.9.4; local Node: 24.16.0. Later documentation and verifier changes have their own package/check identity. This section does not claim stable registry publication.

### Inventory and exercised paths

| Area | Fresh evidence and result | Boundary |
|---|---|---|
| Node palette | All nine contracts inventoried; real combined workflows traversed Input, configured-model Action, typed Condition, Inference, Repeat, Wait, Human review and Return/Fail. | Action is model metadata; Inference is one tool-free completion; Repeat retains its inference/condition body. |
| Commands and agent control | Installed help advertised 38 operations; 95 real `/loops` turns exercised every operation. Actual model agents separately authored, enabled and invoked the combined workflow through canonical tools. | Command adapters used zero model calls. Four transport-operation entries missing from the initial private inventory were added from actual installed help; it was not a product defect. |
| Definition and publication | Native/command create, draft, publish, edit, save, enable/disable, version comparison/restore, archive, deleted discovery, recover, revoke and delete passed. An active published revision remained pinned while a new draft was saved. | Test fixtures were isolated; original user definitions were preserved. |
| Authoring and validation | Native JSON parsing rejected malformed input; zero, false, null, empty string and nested Unicode survived execution. Duplication reported an unreachable node; undo/redo restored both graph states. Search, unpublished testing, publication and activation controls passed. | Empty required text is a present string and is valid; it was not misreported as a missing input. |
| Graph and admission | Producer fields, unsafe/missing bindings, typed values, zero-input graphs, Repeat scope/budgets, distinct invocation and retry identities, and retired admissions passed fresh focused tests. | Host calls in deterministic graph tests are fixtures. |
| Run transitions | Queue/cancel settlement, timeout capacity, grant revocation, completed/failed/waiting/review states, uncertainty and explicit retry ancestry passed focused tests and real command companions. | Local completion/cancellation does not attest to a stopped remote provider. |
| Persistence and fault handling | Fresh suites covered actual SQLite page-limit exhaustion, rollback/commit faults, child-process SIGKILL checkpoints, stale/live ownership, corrupt/future databases, migrations, matched restore, retention and file-backed full outputs. | 278 focused tests, 26 supplemental transport/retention tests and eight private contract/value checks passed. Process death is not physical power-loss testing. |
| Actual macOS full filesystem | A dedicated 256 MiB APFS image reached actual ENOSPC. Admission returned `LOOPS_STORAGE_FULL` with zero fixture effects and unchanged committed state. Upload/snapshot failures preserved existing content and removed temporary files. Freeing only the filler allowed explicit retry; reopened SQLite integrity was `ok`. The owned image was detached. | The Mac's main filesystem was never filled. Provider effects were counted by a deterministic fixture, not a real model. |
| Large results and transport | Native UI completed a 120 KB Unicode JSON run. Real commands retrieved a 50,000-byte output and a 50,011-byte document in 11 digest-verified pages; durable reader acquisition/release, upload conflict, malformed Base64/JSON/schema and host truncation were checked. | Retention/maintenance in the command campaign used previews; actual reclamation is covered by separate storage and sustained-workload checks. |
| Individual/team/customer deployment | Ordinary installation into two separate Gateways produced distinct runs/outputs for the same slug. Foreign-session and cross-Gateway queries were denied. Both own outputs survived restart. Read scope could browse but not author/review; write scope could author but not approve review; admin approval completed the synthetic review. | These are public Gateway connection scopes, not proof of stable independent human principals or arbitrary target-session delegation. |
| Appearance and accessibility | Existing native keyboard/control/focus and Light/Dark/System checks were retained; appearance was restored. | The owner deferred remaining accessibility work. Native VoiceOver automation did not establish a successful screen-reader interaction and was restored to off. R23 remains open. |

The 38 advertised operations were: `archive`, `browse`, `cancel`, `capabilities`, `create`, `delete`, `deleted`, `describe`, `document`, `document_acquire`, `document_release`, `draft`, `edit`, `enable`, `history`, `inspect`, `library`, `list`, `maintenance`, `output`, `publish`, `read`, `recover`, `restore`, `resume`, `retention`, `retry`, `review`, `revoke`, `run`, `runs`, `save`, `status`, `test`, `transport_release`, `upload`, `validate`, and `versions`. `read` is the command alias for the load operation. Every advertised operation was exercised; no command was counted from schema presence alone.

### Real combined workflow

The [accepted #73 receipt](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/73#issuecomment-5751589625) binds the real Codex/Sol-low workflow to the installed archive. The actual agent authored an explicitly requested disabled test draft, enabled it and invoked it; disabled creation was a chosen test step, not a plugin restriction. The native editor saved draft revision 2 while the run kept published revision 1. Separate Gateway restarts preserved Wait and Human review. A real `/loops resume`, native keyboard Approve, and full public output retrieval completed the Return path.

The post-landing Ollama workflow used the same published revision in a fresh session. Exactly one canonical `loops_run` preceded three actual inference completions: one inherited node and two Repeat iterations. A real `/loops resume` reached the stored proposal. Native keyboard Reject followed the authored Fail branch and recorded `LOOPS_EXPLICIT_FAILURE`; all eight retained node outputs were retrieved. A rejected Fail path correctly has no successful top-level output. An additional false-condition companion exited before inference. The owner explicitly delegated these synthetic decisions; plugin authority checks were preserved.

Repeat requested temperature `0` and maxTokens `128`. Public receipts recorded transmission to OpenClaw and explicit reasoning selection. Applied provider values and effective account attribution remained unknown; requested or transmitted values are not described as enforced. Ollama used one qwen3.5:4b worker at 32K context, observed loaded allocation 4.23 GB on the 16 GB Mac, and no added swapouts during that bounded workflow. Both agent turns and inference work settled.

### Failures, repairs and limits

The QA cycle found missing useful lifecycle failure diagnostics in retained CI evidence. [Finding #180](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/180) was admitted as [Bolt #181 / PR #182](https://github.com/Jacob-J-Thomas/openclaw-loops/pull/182), separate from this evidence-only documentation candidate. The repair retains a bounded category/static message and immutable artifact attribution while keeping raw errors, profiles and credentials private. Its final head, independent review, applicable checks and merge receipt are recorded on that Bolt. The original macOS uninstall/reinstall failure's operational cause remains unknown; a later passing retry did not prove a cause or a fix for that earlier failure.

[Finding #183](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/183) identified stale release-overview counts, host version and reset wording. This QA documentation candidate corrects the current README/interface inventory to 38 operations and 37 tools and distinguishes the qualified ordinary reset from unqualified reassignment and durable authority. Runtime code is unchanged.

Preserved test-helper failures were distinguished from product results: the initial command inventory omitted four public operations; the deployment helper first initialized SDK identity before its disposable environment and then assumed every permission denial was thrown by the host. Public clients scoped to separate processes fixed initialization. The final verifier accepted only the observed, asserted denial forms: host `FORBIDDEN` for read-only mutations, and a resolved `loops-error` requiring an authenticated human for write-only review. It verified the review stayed parked after denied decisions, then admin approval and restart readback passed. No permission check was bypassed.

Required SDK01/02/03/04/06 clauses remain in [the dependency register](UPSTREAM_REQUIREMENTS.md). Current-session and negative-route evidence does not establish all target authorization, durable delivery, effective account selection, applied sampling or remote settlement contracts. The owner's [accessibility deferral](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/33#issuecomment-5751683595) is recorded separately. Actual hardware power loss and arbitrary device/provider combinations are not inferred from the bounded tests. Stable 1.0 still requires complete release acceptance and fresh installation of the actual public registry artifact.

### Retained receipt digests

Raw transcripts, profiles, customer fixtures and native captures remain under ignored local `evidence/`. These SHA-256 digests identify the joined receipts without publishing private content:

| Receipt | SHA-256 |
|---|---|
| Engine/graph/storage campaign | `33701dd3731e930ab1017f19468c203ef2542b484e634a0f274b334bfc6cfd39` |
| All 38 real commands | `c24d806945756a0968cf3cb6f0c51f8404e574fd75f4f7b744a61e89fd2fed3e` |
| Completed Codex inspection/output | `218f4d7c1719d50308cfd243401ac5d9b3eb47565152c30c49ba2b6c945073c0` |
| Rejected Ollama inspection/output | `80f6b8d0da36275b6a8c020ce8a60594eae5dc8a678380d73eaa1995521a3adf` |
| Final deployment continuation | `df9cfd5d9d2db778d9c132f9a06b65c8f21c0cd3ab80a253f0ebb700b03c8d27` |
| Actual APFS ENOSPC receipt | `65a0d674d96d3676cd742c84329095bac0f1819685526c57f119e123736789cf` |

Final candidate checks, public receipt and artifact hashes are recorded on [QA74](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/74) and [ClawHub candidate qualification](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/75). Documentation/package changes require their own identity and gates; byte-equivalence may reuse unchanged runtime evidence but must be demonstrated explicitly.
