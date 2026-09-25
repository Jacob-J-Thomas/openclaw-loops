# Whole-application QA report disposition

The owner's September 21, 2026 report examined main `5168f8c928a3ddddbabb66da7a1ad120e7903750`, installed on released OpenClaw 2026.9.5. Its verdict was **not a clean pass**. All five reproduced defects belong to the external plugin's existing 1.0 behavior and are admitted together under [Bolt #221](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/221), with one separate Finding per root cause. None needs a host patch or an expanded plugin API.

## Admitted repairs

| Report / Finding | Required behavior | Regression evidence |
| --- | --- | --- |
| QA-01 / [#216](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/216) | Compact result and checkpoint previews end on Unicode code-point boundaries. Full persisted values remain unchanged. Empty checkpoint text is represented. | `test/receipts.test.ts` covers boundary emoji, exactly-at-limit values, empty/absent values, byte-based result thresholds and complete output after reopening the engine. |
| QA-02 / [#217](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/217) | A valid empty Wait or Human review prompt still presents the authorized Continue, Approve and Reject actions. | Mounted production-editor browser journeys cover empty checkpoints and run controls. Installed PWA keyboard Continue/Approve/Reject and persisted-state checks passed under #223. |
| QA-03 / [#218](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/218) | A late save response cannot replace newer edits, a different selected loop or another agent/session's editor state. Conflict/error handling and recovery drafts stay attached to the originating context. Undo/Redo preserve authored snapshots using the acknowledged revision for subsequent saves. | Controlled pending-save responses exercise the actual mounted editor, including success, failure, conflict, selection/scope changes, recovery storage and subsequent saves. The backend enforces expected revisions for Undo/Redo regression coverage. |
| QA-04 / [#219](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/219) | Duplicating Repeat remaps actual binding tokens and preserves literal predicate data. | `test/qa-duplication.test.ts` verifies mixed token/literal strings, JSON values, whitespace, foreign references, one-iteration success and completion count for original and copied Repeat. A test-local legacy control demonstrates why checking only the final text missed the original exhaustion. |
| QA-05 / [#220](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/220) | Copied labels respect the schema's 100-code-point limit without splitting emoji. | Schema validation and JSON/definition round trips cover the reported boundary and its ASCII control in `test/qa-duplication.test.ts`. |

The repaired candidate's full source, extracted-package, mounted-editor and four-platform results, exact head/base review, archive hashes and merge receipt are accepted under [#223](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/223#issuecomment-5771153194). PR #222 merged those five repairs at `56c9d0351b69c5667cd55042c6d149db6e8e8281`; #224 prepares publication metadata without changing runtime, manifest or UI payloads. Table entries name test coverage and retained limits.

## Deferred, host-owned and evidence-only items

| Report area | Disposition |
| --- | --- |
| Agent browser could not reach the local PWA because of `browser.ssrfPolicy` | That agent's browser/environment limitation is not a demonstrated plugin defect. Preserve host policy. Use the already authorized connected PWA for fresh native qualification; do not relabel API probes or fixture DOM tests as native evidence. |
| ClawHub publication and fresh public-registry installation | Authorized publication preparation is #224. #76 remains the authoritative receipt for actual registry availability, published archive hash and fresh installation/migration. Local package installation does not establish registry release. |
| Full Advanced controls, applied-provider/account attestation and automatic invoking-conversation model/account binding | Explicitly post-1.0. Existing compatible overrides remain preserved; explicit model selection or selected-agent configured defaults provide the supported 1.0 route. Do not promise parameter enforcement or account attribution that cannot be observed. |
| Independent shared-team principals, new cross-session inspection/recovery and destination authority | Host-contract-dependent post-1.0 enhancements. Existing authorized current-session control, retained history and separate-Gateway customer isolation remain in scope. |
| Durable outgoing notification cancellation/delivery and physical remote-provider stop | Deferred API/observability work. Local cancellation cleanup, persisted results and honest uncertain-outcome recovery remain required and tested. |
| New triggers, scripts, persistent context, full agent/plan/goal nodes, subagents, generalized control flow and subloops | Existing X01–X29 expansion roadmap after 1.0; not omissions from the nine-node release palette. |
| Memory embedding-index mismatch | Host/environment concern, outside this plugin's changes. No OpenClaw upstream issues, PRs, comments or patches are authorized for this repair. |
| #129 runtime compaction/Ollama investigation | Deferred host-owned SDK05 work. The 2026.9.5 long-tool-conversation compaction failure remains an observed runtime limitation; no plugin-owned defect or supported correction was identified. |
| #195 historical package-upgrade timeout | Still an unconfirmed historical observation. Its diagnostics were repaired and current four-platform lifecycle checks pass, but those checks do not prove the original cause fixed. |
| Physical power loss | Not claimed. Process termination and real disk-full tests exercise their documented boundaries, not every hardware failure. |
| APFS preallocation, archive directory entries, symlinked dependencies, invalid fixture definitions and incorrect maintenance expectations | Reported harness/fixture mistakes, not demonstrated plugin bugs. Preserve failed evidence and corrected probe scope without manufacturing source changes. |
| VoiceOver | The owner accepted practical manual navigation under #185. This is scoped manual acceptance and does not assert full speech-checklist coverage or WCAG certification. |

## Qualification boundaries

The report's broad source/package, 38-operation, 37-tool, storage, lifecycle, authority, transport, workload and real Codex/Ollama receipts remain useful evidence at their recorded baseline. Their counts overlap and must not be summed. Fresh checks qualify changed receipt, save, checkpoint and duplication behavior. Unchanged provider and storage paths may reuse explicitly identified baseline evidence; controlled completions do not become real-model proof.

This repair preserves plugin identity, full agent lifecycle control, public-host API boundaries, operator policy and the existing nine-node palette. It does not publish to ClawHub, extend OpenClaw itself or declare an unlimited capacity or universal clean-pass guarantee.
