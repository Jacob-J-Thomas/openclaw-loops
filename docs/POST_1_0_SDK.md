# Post-1.0 SDK qualification

SDK05 qualifies a public OpenClaw 2026.9.5 managed-flow route with a disposable external plugin. Run it from the repository root with Node 24.16.0:

```sh
node scripts/verify-expansion-sdk.mjs
```

The verifier creates a token-authenticated loopback Gateway in a new ignored `.dev-profile/expansion-sdk-*` directory. It uses port 21961 when free, otherwise selects an unused private port. It copies `test/helpers/expansion-sdk-plugin.mjs` into a disposable manifest-bearing plugin package and loads that package root through `plugins.load.paths`; no package installation, host source change, provider client, chat request, or model invocation occurs. Raw profile/configuration and Gateway logs remain private under that ignored profile. The sanitized result is written to ignored `evidence/post-1.0/issue-229/`.

The real public calls are `api.registerService`, `api.session.controls.registerSessionAction`, and `api.runtime.tasks.async.managedFlows.bindSession`. The session action creates a managed flow, links a queued `cli` task record without executing a command, applies a revisioned waiting transition, and proves a stale cancellation request conflicts. A queued synthetic `cli` record has no live run owner, so native child cancellation is expected to refuse it with `One or more child tasks are still active.` while the task remains queued; this is an explicit negative observation. A separate empty managed flow proves native flow-state cancellation and restart readback. The verifier also checks that a foreign session cannot read the flow and that the host rejects a write-scoped action from a read-only Gateway client.

`test/contracts/sdk05-consumer.ts` makes the named public TypeScript contracts part of `npm run typecheck`. `runPluginCommandWithTimeout` is declaration-backed. OpenClaw's separately exported JavaScript `plugin-sdk/process-runtime` surface may be qualified through a local typed adapter after runtime evidence; the lack of its `.d.ts` is not evidence that the JavaScript export or its process-tree behavior is unavailable.

This proof establishes neither a durable human/team identity nor recurring-work authorization by itself. The host authenticates the active Gateway connection and session binding. A production plugin must still retain the original grant and revalidate current session and plugin policy before a recurring action. The proof makes no inference, running-child cancellation/settlement, provider authorization, generic remote-worker, tool-category, or cancellation-delivery claim. Running-child cancellation is a separate execution qualification.
