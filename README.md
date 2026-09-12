# OpenClaw Loops — development alpha

An external OpenClaw plugin with a native graph editor and one executor shared by the UI, `/loops`, and 31 agent tools. Agents can read, create, edit, publish, enable, disable, invoke, inspect and delete loops. Valid agent-created loops are enabled by default; drafts are optional. OpenClaw's model and permission policies remain authoritative.

**This is a development alpha, not a finished 1.0.** The active [delivery goal](docs/DELIVERY_PLAN.md) is a standalone 1.0 external plugin with Input, Inference, configured-model metadata Action, Condition, bounded Repeat, Wait, Human review, Return and Fail. Context, scripts, full agents, subagents, broader control flow, triggers, evaluations and advanced operations are deferred until after 1.0. [Delivery status](docs/DELIVERY_STATUS.md) and [verification](docs/VERIFICATION.md) distinguish source tests, live acceptance and remaining gates.

This repository contains the plugin and its development/test tooling. All host integration uses OpenClaw APIs. Required runtime/SDK changes are pursued through [existing OpenClaw issues and separate upstream PRs](docs/UPSTREAM_REQUIREMENTS.md); no host fork, provider client or upstream patch is bundled here. See the [repository boundary](docs/RELEASE_SCOPE.md).

The plugin uses the public **OpenClaw 2026.9.3** SDK. Local acceptance uses **Node 24.16.0** on macOS, real OpenAI Codex and **Ollama 0.32.15 / qwen3.5:4b**. See [deployment and lifecycle](docs/DEPLOYMENT.md), [capabilities](docs/CAPABILITIES.md), [graph format](docs/FORMAT.md), and [upstream SDK requirements](docs/UPSTREAM_REQUIREMENTS.md).

## Develop locally with Ollama

Run from this repository. These commands use separate development state, workspace, configuration and model storage; they do not target the personal assistant profile.

```sh
npm install --prefix .dev-runtime node@24.16.0 --no-audit --no-fund
export PATH="$PWD/.dev-runtime/node_modules/.bin:$PATH"
npm ci --cache .dev-profile/npm-cache
node scripts/init-profile.mjs
```

With the Ollama CLI installed, start its isolated server in a dedicated terminal:

```sh
bash scripts/ollama.sh serve
```

Then build and install the plugin, and start the development Gateway:

```sh
bash scripts/ollama.sh pull qwen3.5:4b
npm run check
node scripts/verify-package.mjs
bash scripts/dev.sh plugins install "npm-pack:$PWD/openclaw-loops-poc-1.0.0-alpha.16.tgz" --force --accept-capabilities
bash scripts/dev.sh gateway run
```

Open [the Ollama Loops page](http://127.0.0.1:19491/plugin?plugin=loops-poc&id=loops). On first connection, use the Gateway secret from `.dev-profile/openclaw.json` in the Control UI's secret field. Keep that private configuration out of Git and URLs. The isolated Ollama server listens on `127.0.0.1:11439`.

The development server uses one loaded model and one inference worker, 32K context, flash attention and an 8-bit KV cache. The observed loaded model allocation was about 3.7 GB; total machine memory includes the OS, apps and Gateway. Keep plugin `maxConcurrentRuns` at 1 for the 16 GB local setup. Existing custom profiles are preserved; the initializer repairs only recognizable old generated single-model policies, with a backup.

## Develop locally with Codex

After building the tarball, initialize the separate Codex test profile:

```sh
bash scripts/codex.sh setup
bash scripts/codex.sh models auth login --provider openai
bash scripts/codex.sh copy-secret
bash scripts/codex.sh gateway run
```

Complete the host's sign-in flow if authentication is missing or expired. Open [the Codex Loops page](http://127.0.0.1:19691/plugin?plugin=loops-poc&id=loops) and paste the copied Gateway secret into the connection form. This profile uses the official `@openclaw/codex` runtime with `openai/gpt-6-astra` as its initial default. Nodes inherit the selected conversation's effective model. The initializer preserves an existing profile and does not enable personal-session catalog discovery.

For source updates, rebuild/package, install that tarball explicitly in each desired dev profile and restart only its Gateway. Setup installs a missing plugin; it does not silently replace an installed version. Stop a dev Gateway with Ctrl-C in its own terminal.

## Author and run

1. Choose an authorized agent and conversation in Loops. Load an example or create a graph.
2. Edit nodes and connections. The keyboard node selector, binding picker, duplication, arrangement and undo/redo support graphical authoring.
3. **Save draft** creates a version without replacing an existing publication. **Save & enable** publishes the edited revision. **Enable loop** and **Disable** control saved revisions. Versions can be compared, restored or published separately.
4. Enter the declared inputs and run, or use **Test current draft** before publication. Inspect real outputs, the pinned definition, model attribution, waiting/review state and recovery options.
5. Ask the chat agent to discover and actually invoke a saved loop. The same definitions and executor serve UI, commands and tools.

```text
/loops list
/loops run <slug> [text or JSON object] [--request-id <id>]
/loops status <run-id>
/loops resume <run-id>
/loops cancel <run-id>
/loops review <run-id> approve|reject
/loops help
/loops help <operation>
/loops <operation> <JSON object>
/loops read <loop-id>
/loops versions <loop-id>
```

Every editor operation is also available through the command's JSON argument form and uses the same backend schema. For example, `/loops capabilities {}`, `/loops history {"limit":20}`, `/loops enable {"id":"loop-id","revision":2,"enabled":true}`, or `/loops publish {"id":"loop-id","revision":2,"expectedRevision":3}`. Use `help` for discovery and `help <operation>` for its exact fields. Authoring commands require the host's write authority; a Human review still requires authenticated human authority. The `read` command aliases the backend's `load` operation.

The JSON form returns the same receipt as tools and the editor. Text shortcuts preserve the readable run summary. Large results return a document reference or an explicitly labeled preview; use `document` or `output` pages to retrieve the complete result. Large input fields accept staged references from `upload`, with the same authorization and validation as agent tools.

OpenClaw 2026.9.3 limits inline command arguments to 4,096 UTF-16 units. Loops detects host-altered arguments and returns `HOST_COMMAND_INPUT_CHANGED` before executing an operation. For a larger definition or input, stage JSON with `upload` chunks small enough that each complete command argument fits that host limit, then pass the returned reference. The editor and agent tools have their own documented transport budgets.

A normal command invocation receives a fresh identity. Reuse an explicit request ID only for a retry of the same admission; changed inputs with that ID conflict. Tool-call IDs and UI request UUIDs provide equivalent retry identity. This does not promise exactly-once external side effects.

Agents use `loops_library` and `loops_read` for the full library, `loops_create`/`loops_edit` for authoring, and `loops_run` for real execution. `loops_run` accepts either named `input` values or a `text` shortcut; omit both for zero-input loops. An empty enabled list does not mean the library is empty. Agents can publish, enable, disable, archive, recover and delete on request. Only a graph containing an explicit **Human review** pauses for the authenticated human decision path.

The manifest lists all 31 tools. Additional operations cover capability/preflight checks, draft testing, immutable versions, full inspection, paged output/history and explicit recovery. For an older dev profile with explicit tool additions, merge the current inventory before restarting:

```sh
node scripts/enable-agent-tools.mjs .dev-profile/openclaw.json
node scripts/enable-agent-tools.mjs .dev-profile/codex-test/openclaw.json
```

Run only for profiles that exist. The helper preserves unrelated tools and deny rules.

## Advanced inference

Each Inference node, including a Repeat body, has optional model/agent/reasoning overrides and a collapsible **Advanced settings** category. Unset values inherit host behavior. Explicit `0` survives validation, persistence and transmission. Reset one field or all overrides. Model switches preserve saved overrides and reveal incompatibilities.

OpenClaw 2026.9.3 publicly exposes temperature and output tokens as advisory hints on the isolated completion API. Top p, top k, min p, typical p, frequency/presence/repetition penalties, seed and stop sequences are visible with an unsupported explanation because that API does not expose them. Unsupported explicit imports fail preflight; unset controls do not block execution. Requested/transmitted settings are recorded separately from unknown provider enforcement. Closing those gaps requires the targeted public SDK additions described in the plan, not changes to global provider settings.

V2 loops can omit the active timeout to use the host's timeout. An explicit loop timeout counts active execution across steps and resumes. Existing saved limits are preserved.

## Durability and limits

Definitions, immutable revisions, admissions, attempt evidence and complete outputs use plugin-owned SQLite with locking, transactions, integrity checks and backup support. History pages use an owner-scoped database index; completed and parked runs load individually when requested instead of staying in memory. Legacy JSON is validated and backed up before import; the original file remains. Running definitions are pinned. A draft can change independently of publication.

There is no 20-loop or 50-run retention cap. History and full output have paged retrieval; records are not silently evicted. The current store still loads complete state and uses synchronous commit barriers, so large-scale acceptance remains open. Queue concurrency is configurable. Cancelled host work retains its physical execution slot until cleanup settles. Checkpoint retry is distinct from deliberately repeating an uncertain attempt.

Large feature requests use chunked uploads; large results use immutable, conversation-scoped documents with verified Unicode paging. The UI handles both automatically. Agents use `loops_upload` and `loops_document` when a value exceeds the host message envelope. See [transport and operator budgets](docs/TRANSPORT.md).

Local editor drafts persist in browser storage per loop, agent and conversation, including unfinished invalid edits. Concurrent edits can be merged; conflicting fields require a deliberate choice. Archived/deleted definitions are recoverable. The library is Gateway-wide, while run control is tied to the host-resolved conversation generation; shared-team and cross-reset authority require further public host contracts. Separate customers must use separate Gateways/state/credentials/workspaces.

[Deployment guidance](docs/DEPLOYMENT.md) covers upgrade, matched backup rollback, disable and uninstall. Uninstalling does not authorize erasing retained definitions or history. The personal assistant and EmbodySense remain outside this plugin's state and execution scope.

Failed runs expose a stable code, phase, failed node, selected model, retryability and a recovery step in the inspector and agent receipts. Commands include the code and recovery guidance. Storage-full, locking, access, corruption and I/O failures have distinct diagnoses. Wrapped provider errors are classified without retaining raw credential, URL or request-body text in shared history. Unrecognized host failures remain generic; classification does not prove that a provider performed no work. Retries remain explicit.

## Contribute and verify

`npm run check` runs types, lint, deterministic tests and both builds. `node scripts/verify-package.mjs` exercises actual SDK adapters from the extracted tarball. Live command/tool/UI tests use dedicated synthetic conversations and record their evidence separately. GitHub CI is configured for macOS/Linux and Node 24.16.0/26.1.0; an unrun workflow is not passing evidence.

See [contribution guidance](CONTRIBUTING.md), [MIT license](LICENSE), and [third-party notices](docs/THIRD_PARTY_NOTICES.md). [Public source](https://github.com/Jacob-J-Thomas/openclaw-loops) and its plugin history are available. Follow [CI](https://github.com/Jacob-J-Thomas/openclaw-loops/actions/workflows/verify.yml) and [delivery status](docs/DELIVERY_STATUS.md) for remaining acceptance; no 1.0 registry release has been published.
