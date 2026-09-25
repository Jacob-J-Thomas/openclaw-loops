# Contributing

Follow the repository's [Loops AIDLC process](https://github.com/Jacob-J-Thomas/openclaw-loops/blob/main/docs/AIDLC.md): one scoped Bolt issue per ready PR, every PR based on main, at most three Codex review requests, exact-head verification and evidence-based merge/closure. The roadmap is tracked with native GitHub sub-issues. Changes to the plugin use this process; historical direct-push alpha commits remain preserved.

Use Node 24.16.0 or supported Node 26 and the exact OpenClaw peer version in package.json. For a local checkout, run both `toolchain` and `ci` phases of the isolated dependency launcher documented in README before `npm run check`; the direct `npm ci` command is reserved for disposable CI environments. `node scripts/verify-package.mjs` verifies the extracted archive against the actual feature SDK with fake model transport. It does not replace live acceptance.

Type checking uses TypeScript 7.0.2 (`tsc` from the `@typescript/native` npm alias). ESLint uses the TypeScript 6 compatibility API (`typescript` aliases `@typescript/typescript6@6.0.2`), following [Microsoft's side-by-side installation guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/). Both versions are locked; ordinary `npm ci` must resolve them without peer-dependency bypasses. The plugin runtime does not include either compiler.

Keep `.dev-profile` private. Never commit credentials, personal history, model files or host state. Use dedicated synthetic chats for live evidence. Do not modify a personal assistant or EmbodySense project as part of this plugin.

Preserve public SDK APIs and host authority. Version semantic changes, test regressions and document migration/rollback. Execution adapters must explain side effects, permission, cancellation and uncertain outcomes. Full agent control over the loop lifecycle is required; actual human review stays explicit.

The active scope is the existing nine-node palette for 1.0, including Advanced inference settings. Follow the [delivery plan](docs/DELIVERY_PLAN.md) and [repository boundary](docs/RELEASE_SCOPE.md). Expansion families remain a later roadmap. Do not add OpenClaw source, provider implementations, runtime patches or a required host fork to this repository or package.

For an SDK gap, refresh the [upstream dependency register](docs/UPSTREAM_REQUIREMENTS.md), existing issue and linked PR before implementing. Work in a separate OpenClaw checkout/fork under that repository's contribution rules. Help the current PR author where a candidate exists; create a focused issue-linked PR only for uncovered scope. Preserve contributor credit. Keep Loops-specific consumer tests here and generic host fixes upstream. Adopt a new API only after it is available to external plugins in a released, tested host version.

Build/test success, verified local installation, upstream availability and public marketplace release are separate gates. Track evidence in the delivery status.
