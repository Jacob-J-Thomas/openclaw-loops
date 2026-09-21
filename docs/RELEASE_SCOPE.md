# Repository and release boundary

The active [delivery goal](DELIVERY_PLAN.md) is the verified 1.0 release of one external OpenClaw plugin. This document defines what may be published in its source repository and installation package. It supersedes earlier wording that included every expansion milestone in the same goal.

## Plugin repository

Public source destination: `Jacob-J-Thomas/openclaw-loops`. The owner has authorized creating the public repository and pushing the reviewed existing history. Preserve that plugin history; do not publish a workspace snapshot or push unrelated branches/tags.

Include:

- The nine-node plugin, graph/execution contracts, UI, commands, agent adapters and plugin-owned storage.
- Tests, synthetic fixtures/example loops, build/package tooling and CI.
- Isolated development helpers that configure and invoke ordinary OpenClaw/Ollama CLIs for testing. These are development tools, not a required runtime sidecar or a provider implementation.
- MIT licensing, dependency notices, contribution/install/migration/deployment documentation, release evidence summaries and the deferred roadmap.

Exclude:

- OpenClaw source/checkouts/patch stacks, a vendored host SDK, private internal imports or a custom Gateway distribution.
- Direct provider clients, model-serving implementations, copied account/authentication stores or runtime replacements.
- New script/tool/full-agent/context/subloop/trigger node families before their later milestone is admitted.
- EmbodySense code, host provisioning/billing/operations services, personal state and unrelated repositories.
- Generated runtime profiles, tokens, personal chats, model files, raw private evidence, local dependency installations and supplied private handoff material.

Source documentation and test fixtures may describe absent capabilities or later roadmap items. That does not authorize shipping their implementation in 1.0. Earlier historical notes retain their original evidence; the current delivery plan/status governs current scope.

## Runtime contract

All integration with OpenClaw uses supported APIs available to ordinary external plugins. The host owns runtime execution, model/account selection, permission decisions, sessions and delivery. Loops owns its graph definitions, immutable revisions, run records, editor and one SQLite database in its host-provided plugin state location. Node/React libraries and access to plugin-owned files do not constitute a second host runtime.

No required installation step may patch OpenClaw, whitelist Loops as trusted/bundled, supply administrator credentials to imitate a missing capability, or call a model provider directly. A shipped public export that is restricted to trusted plugins is not an available external-plugin contract. Use a practical supported alternative for 1.0 where one exists; unsupported optional generation settings remain explicitly reported and never disable a model when unset.

Inference remains one fresh, tool-free completion. An existing host-owned durable model-only API may implement an attempt if qualification proves those semantics, settings and authority; choosing that API does not introduce full-agent or subagent nodes. Do not select it solely to evade a request-lifetime restriction.

[Bolt #201](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/201) implements this source candidate's revised 1.0 rule: use an explicit node model first, otherwise the host agent's configured default on every path through generic public-plugin completion. New runs do not copy session account or reasoning overrides; unset reasoning follows the selected runtime. Legacy pinned execution overrides and current host-policy denials remain preserved. Earlier alpha qualification does not establish this changed behavior or final release acceptance.

## Deferred host enhancements

Advanced expansion, outgoing-notification AbortSignal and delayed durable notifications, automatic conversation model/account inheritance parity, independent shared-team principals, and new cross-session recovery are post-1.0. Existing compatible Advanced values and controls remain preserved. Explicit model selection or a configured public-host default is acceptable for 1.0, and current host-policy denials remain observable rather than being bypassed.

No OpenClaw issue, PR, comment, maintainer coordination or patch is authorized for this delivery. The previous local SDK experiments remain private diagnostic material. A future owner-directed adoption must recheck a released public contract and qualify the packaged plugin; no experiment is an installation dependency.

## Publication checks

Before a source push, review the exact tree and reachable history for excluded files, credential material and unrelated code. Verify the intended remote owner/repository, branch and commit; push only that reviewed branch. Generated test profiles and upstream checkouts must remain ignored and untracked. Preserve the existing commits instead of rewriting history simply because the plan has changed.

Before a package release, inspect the actual `npm pack` file list and built imports, not just `.gitignore`. The package allowlist contains compiled plugin assets, manifest, examples and end-user/contributor documentation. OpenClaw remains a peer dependency and its SDK imports remain external to the plugin bundle. Development launch scripts, tests, CI internals, host source and local evidence are not installed as part of the plugin.

Run source checks and extracted-package SDK tests, then ordinary external-plugin installation. Verify in-scope model calls, current-session authority, cancellation, complete-result retrieval and compatibility of existing optional controls through the declared released host. Full Advanced transport attribution and delayed notifications are not 1.0 gates. Publish the artifact hash and source commit, run ClawHub validation and publishing dry run, publish under the verified publisher, and test a fresh registry installation. Registry review/availability must be checked rather than inferred from upload success.

The public GitHub development baseline may be published before 1.0 is ready, with its alpha status visible. Keep `private:true` until the package publication step deliberately changes it. GitHub source publication, hosted CI, ClawHub upload and verified 1.0 release are separate milestones.

## Current boundary review

The pre-revision baseline `6f4b408633a4946e091ad492795f590de5909d7b` contained 97 tracked files and 12 commits. Its runtime host imports use `openclaw/plugin-sdk/*`; model execution goes through `api.runtime.llm.complete` or the command-bound completion capability. The reviewed runtime contains no direct provider HTTP client or upstream patch loader. Its local upstream checkout, profiles and raw evidence are ignored and absent from tracked history. Recheck the final publication commit and packed file manifest after this documentation revision; the earlier scan is not proof of later contents.
