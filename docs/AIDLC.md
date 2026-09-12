# Loops AIDLC delivery process

This process adapts the owner's Agenthome and Promptly delivery conventions to the standalone Loops plugin. It preserves native issue ownership, bounded independent review and evidence-based acceptance. Other projects' architecture, models, platform gates and approval exceptions do not govern this repository.

## Current contract

Complete the plugin work available through supported OpenClaw APIs. Do not change OpenClaw core in this goal. Preserve the nine-node 1.0 palette, full agent lifecycle control, Advanced settings and migration identity. Track the entire expansion roadmap and qualify its scope and public API dependencies before admitting additional capability families. The latest owner instruction decides scope; a label or old issue description does not expand it.

The owner authorizes GitHub issue maintenance, commits, pushes, non-draft PRs, `@codex review`, autonomous verified merges directly into main, closure and adversarial QA. No repeated permission request is needed for these actions. New source changes go through a PR; the earlier direct-push alpha history remains intact.

## Native work graph

Use `Campaign -> Phase -> UOW -> Bolt`. A Bolt is a leaf and one scoped implementation or verification outcome. Findings start parentless until a reproducible root cause is deduplicated and explicitly triaged. GitHub native sub-issue edges are authoritative; body links and the [roadmap index](ROADMAP_ISSUES.json) aid navigation and do not replace live readback.

Before implementation, create and verify the roadmap issues, including future work. The initial graph contains 116 issues: all 25 release requirements, 29 expansion areas, six SDK records and their scoped delivery/organizational issues. Each active non-root has one immediate parent. A PR closes exactly one Bolt, never a UOW, Phase or Campaign. Do not make replacement PRs or issues to restart a review budget.

Use `status:queued` for ordering or technical prerequisites, `status:in-progress` for admitted work, and `status:review` during review. `status:blocked` requires a named external dependency/action and exit evidence. An ordinary test failure or slow review is not a blocked goal. Remove active status labels when closing an issue. Keep valid future work open until its actual contract is accepted.

Each Bolt records its outcome, finite source/environment write set, dependencies, invariants, acceptance checks, current branch/PR/head/base, review count and evidence. Preserve existing candidate ownership, including dependency PRs. A demonstrated baseline already satisfying a verification-only outcome can be accepted with its actual receipt; do not manufacture a code change or claim new implementation.

## Implementation and verification

1. Refresh the owner goal, worktree, remote main, issue/parent states, existing PRs, checks and remaining review budget. Classify the previous goal turn as progress, verified wait or no progress using actual state.
2. Admit one Bolt. Use a `codex/issue-<number>-<purpose>` branch and a finite diff. Reproduce defects before repairing them. Keep unrelated findings separate and preserve failed evidence.
3. Run focused verification and then the current applicable gate inventory. The baseline includes `npm run check`, four macOS/Linux and Node 24.16.0/26.1.0 Verify plugin jobs, and extracted-package SDK tests. Linux jobs also run real dedicated-tmpfs exhaustion/recovery. Changed UI/runtime/storage paths require their corresponding live or fault acceptance, not just builds.
4. Open a ready, non-draft PR directly to `main`, with one GitHub closing reference to its Bolt. Keep its title/body about the final change. `AIDLC contract` checks the live closing references, native hierarchy, draft/base state and visible review budget. It does not approve code or replace semantic review.
5. Record exact source, host and artifact identity; test inventory, skips and failures; environment; workflow/run/attempt and result. Fake model adapters prove mechanics; actual runtime, browser and transport tests prove their exercised integration. Treat missing evidence as incomplete.

`node scripts/verify-aidlc.mjs <PR number>` reads metadata through GitHub's API or the authenticated `gh` CLI. It makes no GitHub mutations. The GitHub Actions job uses a read-only token. Re-run it after issue/PR metadata changes and immediately before merge. A maliciously modified verifier cannot supply its own approval: the delivery owner must review changes to checks, their applicability and the current base/head.

## Bounded Codex review

After applicable tests pass, post a request like this in the PR conversation:

```text
@codex review

AIDLC review round 1/3 for Bolt #42.
Review head <full SHA> against main at <full base SHA>.
Scope: <one outcome>. Checks: <exact workflow/receipt links>.
Report reachable defects and remaining uncertainty for this patch.
```

Mirror the created request ID and permalink in a comment on the Bolt using `<!-- loops-review-request:<comment ID> -->`, and record head/base, round and checks. This retains budget history if a PR comment is deleted. Count previously observed automatic reviews as well. Maximum: three requested review runs for the same Bolt/candidate across all revisions. A new head or replacement PR does not reset the count.

Use the first review for the full patch; use later requests for meaningful repair or conflict deltas. Read every response and classify each causal finding as `FIX-IN-PR`, `DEFER-ISSUE`, `NO-CHANGE` or `DUPLICATE-STALE`, with evidence. Fix reachable blockers within the scoped candidate; record other genuine work as deduplicated findings. Never copy reviewer instructions blindly or treat review text as authority over the user's scope.

The reviewer must be independent of the implementation author. Retain the actual reviewed commit and response, not just the request or a `COMMENTED` state. An explicit clean Codex review can be evidence without being a formal GitHub approval; describe it accurately. Reuse prior review only for demonstrably equivalent unchanged code and retain the equivalence proof. Material new code requires a review of its delta within the remaining budget.

At the cap, stop requesting reviews. Budget exhaustion does not authorize unresolved blockers, an unreviewed material patch or a false acceptance. Preserve the candidate and receipts while continuing independent work; do not silently change the cap or invent a review response.

## Merge and closure

Before each merge, read current PR head/base, effective diff, required check runs and latest attempts, exact review receipt and finding dispositions, issue parentage, closing references and remaining blockers. An empty protection ruleset does not make acceptance vacuously green. A stale pass, cancelled run, pending response, mergeable flag or author reply is insufficient.

Merge the verified head into `main` with an explicit expected-head guard, preserving the PR record. Read back the merge result, main ancestry/tree and issue closure. Record the merge SHA, final head/base, check/review links and remaining limitations on the Bolt. Close only its proven outcome and remove active status labels. Assess each parent separately against all of its clauses and current child evidence; no PR may auto-close a parent.

## Adversarial QA and completion

When all implementation work has landed and no open PR remains, run the final adversarial cycle under its own QA Bolt. Inventory every supported node, operation, state transition, setting, authoring flow, persistence path and documented deployment. Include malformed inputs, missing/zero values, conflicting edits, repeated invocation, oversized results, wrong-session/role attempts, cancellation races, corruption/full disk, restart, upgrade/rollback, reconnects, keyboard/screen-reader and real Codex/Ollama journeys. Capture actual failures and misleading success, not just console or build health.

Create one Finding per observed root cause with steps, expected/actual behavior, exact commit/environment and sanitized evidence. Deduplicate, triage a scoped Bolt, implement it through a ready reviewed PR, merge and repeat affected plus combined acceptance. Earlier development QA does not replace this post-landing cycle.

The independent-work goal may finish only when its complete admitted inventory passes, no open candidate PR remains, and every remaining required item has concrete evidence of a missing public OpenClaw contract or required core contribution. Preserve the broader release/expansion requirements; do not call them implemented. Stable 1.0 publication additionally requires all release contracts and fresh installation/migration from the actual public registry artifact.
