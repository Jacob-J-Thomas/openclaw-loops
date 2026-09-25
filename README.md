# OpenClaw Loops 1.0.0

An external OpenClaw plugin with a native graph editor and one executor shared by the UI, `/loops`, and 37 agent tools. Agents can read, create, edit, publish, enable, disable, invoke, inspect and delete loops. Valid agent-created loops are enabled by default; drafts are optional. OpenClaw's model and permission policies remain authoritative.

The nine-node palette provides Input, Inference, configured-model metadata Action, Condition, bounded Repeat, Wait, Human review, Return and Fail, with drafts, publication, versioning, inspection, recovery and complete paged results.

The standalone 1.0 baseline completed publication preparation. This feature branch adds post-1.0 work and requires its own source, package and combined qualification receipts before delivery; it is not the artifact accepted for publication. Registry availability, the published archive hash and fresh registry installation/migration are recorded only by [Bolt #76](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/76). Context, scripts, full agents, subagents, broader control flow, triggers, evaluations and advanced operations are tracked under the [feature delivery contract](docs/POST_1_0_DELIVERY.md). [Delivery status](docs/DELIVERY_STATUS.md) and [verification](docs/VERIFICATION.md) distinguish accepted evidence from outstanding work and publication state.

This repository contains the plugin and its development/test tooling. All host integration uses supported released OpenClaw APIs. No OpenClaw issue, PR, comment or patch is part of this delivery; no host fork, provider client or upstream patch is bundled here. See the [repository boundary](docs/RELEASE_SCOPE.md).

The candidate uses the public **OpenClaw 2026.9.5** SDK. [Final package preparation #224](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/224) records the standalone 1.0 repack's source/archive identity, not this feature branch's artifact. [Historical candidate qualification](docs/VERIFICATION.md#100-candidate-qualification) retains that baseline's four-platform checks, ordinary installation, matched backup/restore, static validation and publishing dry run. Accepted [#223](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/223#issuecomment-5771153194) records 659 source tests, 86 extracted-package tests, 22 mounted checks and four-platform CI; the owner also accepted practical manual VoiceOver navigation under [#185](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/185). That baseline's local qualification used **Node 24.16.0** on macOS, real OpenAI Codex and **Ollama 0.32.15 / qwen3.5:4b** through an ordinary isolated-profile installation. Current feature qualification remains scoped to its individual Bolt receipts until combined acceptance. See [deployment and lifecycle](docs/DEPLOYMENT.md), [capabilities](docs/CAPABILITIES.md), [graph format](docs/FORMAT.md), and [supported-host boundaries](docs/UPSTREAM_REQUIREMENTS.md).

Install from the public registry after [#76](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/76) records availability:

```sh
openclaw plugins install clawhub:openclaw-loops-poc@1.0.0 --accept-capabilities
```

## Develop locally with Ollama

Run from this repository. These commands use separate development state, workspace, configuration and model storage; they do not target the personal assistant profile.

```sh
npm install --prefix .dev-runtime node@24.16.0 --no-audit --no-fund
export LOOPS_NODE_BIN="$PWD/.dev-runtime/node_modules/node/bin/node"
export PATH="$(dirname "$LOOPS_NODE_BIN"):$PATH"
# Optional for a fresh profile when 11439 is already owned by another service:
# export LOOPS_OLLAMA_PORT=<unused high loopback port>
npm ci --cache .dev-profile/npm-cache
"$LOOPS_NODE_BIN" scripts/init-profile.mjs
```

With the Ollama CLI installed, start its isolated server in a dedicated terminal:

```sh
export LOOPS_OLLAMA_BIN="$(command -v ollama)"
bash scripts/ollama.sh serve
```

Then build and install the plugin, and start the development Gateway:

```sh
export LOOPS_OLLAMA_BIN="$(command -v ollama)"
bash scripts/ollama.sh pull qwen3.5:4b
npm run check
node scripts/verify-package.mjs
loops_archive="$(node -p "const p=require('./package.json'); p.name+'-'+p.version+'.tgz'")"
bash scripts/dev.sh plugins install "npm-pack:$PWD/$loops_archive" --force --accept-capabilities
bash scripts/dev.sh gateway run
```

Open [the Ollama Loops page](http://127.0.0.1:19491/plugin?plugin=loops-poc&id=loops). On first connection, use the Gateway secret from `.dev-profile/openclaw.json` in the Control UI's secret field. Keep that private configuration out of Git and URLs. The isolated Ollama server listens on `127.0.0.1:11439`.

The development server uses one loaded model and one inference worker, 32K context, flash attention and an 8-bit KV cache. The observed loaded model allocation was about 3.7 GB; total machine memory includes the OS, apps and Gateway. Keep plugin `maxConcurrentRuns` at 1 for the 16 GB local setup. Existing custom profiles are preserved; the initializer repairs only recognizable old generated single-model policies, with a backup.

The wrappers require exact Node 24.16.0 or 26.1.0. `scripts/dev.sh` resolves only this checkout's pinned `node_modules/openclaw/openclaw.mjs`; a missing project installation fails before dispatch. It admits the documented build, local package installation and inspection, config validation, Gateway run/calls, session agent command, and isolated Codex sign-in command shapes. Other CLI flags and methods require a deliberate harness update. Runtime commands require the selected profile's own config, state, workspace, cache, browser directory, temporary directory and token-authenticated loopback port. Set `LOOPS_PROFILE=codex-test` for that profile through `scripts/codex.sh`; do not redirect inherited `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME` or browser/cache paths to another profile. The wrappers remove inherited provider credentials and use a private home. `plugins build` has a separate disposable build home and needs no runtime profile, so `npm run build` remains usable immediately after `npm ci`.

`scripts/ollama.sh` requires an explicit executable path in `LOOPS_OLLAMA_BIN`. The Ollama profile admits only the loopback provider endpoint recorded when it was initialized; `LOOPS_OLLAMA_PORT` defaults to 11439 and may select a different unused high port for a fresh profile. Export the same value in each Ollama and Gateway terminal. A mismatch with the saved profile fails before dispatch. The Codex profile admits the public `openai` agent runtime with its own profile authentication and only `{ "sessionCatalog": { "enabled": false } }` in its plugin configuration. Edited profiles naming other provider routes, Codex runtime/catalog/discovery overrides, external plugin paths or enabled channels fail admission. The supported `agents.entries` roster may use paths inside this profile's workspace and state directories and its approved provider; explicit session-store paths, custom agent runtimes and sandbox subtrees are not admitted. Both generated profiles explicitly disable the runtime browser; edited browser attachment, import, MCP and launch settings are refused. Native browser qualification remains with its separate product owner, and the plugin's browser capabilities are unchanged. Ollama refuses to start when its selected port is occupied, keeps model files in this checkout, and uses one machine-local inference-worker lease. Model CLI requests and the Ollama Gateway require the live owned child and a ready lease for that exact port. The Gateway wrapper likewise refuses a foreign listener or concurrent owner on its configured port. Ctrl-C forwards to the owned process group; each wrapper removes only its matching lease after the group settles and saves a private cleanup/exit receipt under ignored `.dev-profile/receipts/` (or the selected profile's `receipts/`). Supervision failures produce a nonzero wrapper result even if the child exits cleanly. If a wrapper reports an unreadable lease, inspect it before retrying; do not stop an unrelated daemon to make the check pass.
Service readiness also requires evidence that the owned child PID holds the selected IPv4 loopback listener. This check uses `lsof` scoped to that PID on macOS and the owned PID's socket descriptors with `/proc/net/tcp` on Linux; missing ownership evidence refuses dispatch. The one-worker inference lease lives in an owned private directory under canonical `/tmp`, independent of inherited temporary-directory variables.
Lease mutations use an atomic same-directory gate. A published stale lease can be recovered once its parent, child and owned process group are gone. If a process dies while holding the short acquisition gate, the wrapper refuses automatic recovery; inspect the private gate and associated lease before removing the abandoned gate manually. It never removes a gate or lease merely because another caller appears slow.
The shell wrappers clear `NODE_OPTIONS` and `NODE_PATH` before starting any Node interpreter. Child processes inherit only `PATH`, locale, terminal, color, `CI` and time-zone settings before the wrapper adds its own profile paths and provider settings. Inherited proxy variables are omitted, so network-dependent sign-in or package installation requires a separately controlled network environment rather than a personal shell proxy.

Profile updates and explicit tool-inventory updates stage complete files before atomic replacement. Each change retains a uniquely named, byte-exact `openclaw.json.before-loops-*.bak` with private permissions. Repeating an unchanged setup creates no new backup. Failures before replacement preserve the active profile; a killed process may leave a private `.tmp` file for diagnosis. A detected concurrent edit aborts the replacement, so rerun setup against the current file. This is not a lock on OpenClaw or other configuration writers; avoid editing the same profile during setup. These checks cover process interruption, not power-loss guarantees.

## Develop locally with Codex

After building the tarball, initialize the separate Codex test profile:

```sh
bash scripts/codex.sh setup
bash scripts/codex.sh models auth login --provider openai
bash scripts/codex.sh copy-secret
bash scripts/codex.sh gateway run
```

Setup installs `@openclaw/codex` at the exact version of this checkout's pinned OpenClaw host, replacing only a matching package already materialized inside this disposable profile. It accepts an existing installation only when the enabled plugin and its installed path/version match that host; the Loops installation must also match this checkout's package version and archive hash. A plugin-info lookup alone does not establish that either plugin is installed in this profile. A previously generated Codex profile without the explicit disabled browser and catalog settings is refused; create a fresh disposable profile rather than treating an old or edited profile as qualified.

Complete the host's sign-in flow if authentication is missing or expired. Open [the Codex Loops page](http://127.0.0.1:19691/plugin?plugin=loops-poc&id=loops) and paste the copied Gateway secret into the connection form. This profile uses the official `@openclaw/codex` runtime with `openai/gpt-6-astra` as its initial default. The candidate uses an explicit node model first, otherwise the host agent's configured model on every path through generic public-plugin completion. Unset reasoning follows the selected runtime. New runs do not copy a conversation account or reasoning pin; legacy pinned accounts and honest host-policy denials remain preserved. Automatic conversation model/account inheritance parity remains deferred. The initializer preserves an existing profile and does not enable personal-session catalog discovery.

For source updates, rebuild/package, install that tarball explicitly in each desired dev profile and restart only its Gateway. Setup installs a missing plugin; it does not silently replace an installed version. Stop a dev Gateway with Ctrl-C in its own terminal.

## Author and run

1. Choose an authorized agent and conversation in Loops. Load an example or create a graph.
2. Edit nodes and connections. The keyboard node selector, binding picker, duplication, arrangement and undo/redo support graphical authoring.
3. **Save draft** creates a version without replacing an existing publication. **Publish r…** selects the saved revision for new runs. The publication controls enable or disable new starts. Versions can be compared, restored or published separately.
4. Enter the declared inputs and run, or use **Test current draft** before publication. Inspect real outputs, the pinned definition, model attribution, waiting/review state and recovery options.
5. Ask the chat agent to discover and actually invoke a saved loop. The same definitions and executor serve UI, commands and tools.

Use **Search loops** to filter the saved library. Choose a node on the canvas or through **Select node to edit**, then edit its properties. **Insert available binding** offers input values and outputs guaranteed to precede that node. A whole binding preserves the value's type; embedding it in text produces text. Inference and Repeat selections append to their inference prompt, or replace a JSON literal prompt with the selected binding. Other supported consumer nodes replace their corresponding value or condition's left operand.

**Duplicate node** gives the copy a separate identity and position; connect it into the graph before running. **Arrange** changes positions while preserving nodes, connections and settings. Version 1 drafts are translated into their original layout range when they fit; use version 2 when a layout cannot fit there. **Undo** and **Redo** operate within the current editor session. Unsaved edits are retained as recoverable local drafts for the selected agent and conversation; saving a draft commits a revision to the Gateway.

Under **Versions and library actions**, **Compare version with current draft** lists changed definition sections and added, changed or removed nodes. **Restore as draft** creates a new revision from the selected version without replacing publication. **Publish this version** selects that saved version separately. Review the displayed revision and draft/publication state before running or testing.

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

The pinned OpenClaw 2026.9.5 command contract retains the 4,096 UTF-16-unit inline argument limit. Loops detects host-altered arguments and returns `HOST_COMMAND_INPUT_CHANGED` before executing an operation. For a larger definition or input, stage JSON with `upload` chunks small enough that each complete command argument fits that host limit, then pass the returned reference. The editor and agent tools have their own documented transport budgets.

A normal command invocation receives a fresh identity. Reuse an explicit request ID only for a retry of the same admission; changed inputs with that ID conflict. Tool-call IDs and UI request UUIDs provide equivalent retry identity. This does not promise exactly-once external side effects.

Agents use `loops_library` and `loops_read` for the full library, `loops_create`/`loops_edit` for authoring, and `loops_run` for real execution. `loops_run` accepts either named `input` values or a `text` shortcut; omit both for zero-input loops. An empty enabled list does not mean the library is empty. Agents can publish, enable, disable, archive, recover and delete on request. Only a graph containing an explicit **Human review** pauses for the authenticated human decision path.

The manifest lists the current tool inventory, including `loops_save` for full-definition saves. Additional operations cover capability/preflight checks, draft testing, immutable versions, full inspection, paged output/history and explicit recovery. For an older dev profile with explicit tool additions, merge the current inventory before restarting; otherwise its tool profile may exclude newly added operations:

```sh
node scripts/enable-agent-tools.mjs .dev-profile/openclaw.json
node scripts/enable-agent-tools.mjs .dev-profile/codex-test/openclaw.json
```

Run only for profiles that exist. The helper preserves unrelated tools and deny rules.

## Advanced inference

Each Inference node, including a Repeat body, has optional model/agent/reasoning overrides and a collapsible **Advanced settings** category. An unset model uses the host agent default and unset reasoning follows the selected runtime; new runs do not copy conversation/session overrides. Explicit `0` survives validation, persistence and transmission. Reset one field or all overrides. Model switches preserve saved overrides and reveal incompatibilities.

OpenClaw 2026.9.5 publicly exposes temperature and output tokens as advisory hints on the isolated completion API. Top p, top k, min p, typical p, frequency/presence/repetition penalties, seed and stop sequences are visible with an unsupported explanation because that API does not expose them. The release adds `responseFormat` and `requiredAuthMode` only to direct-provider completion; Loops keeps its fresh, tool-free isolated mode and does not submit those controls. Unsupported explicit imports fail preflight; unset controls do not block execution. Requested/transmitted settings are recorded separately from unknown provider enforcement. Full Advanced expansion is post-1.0; the existing compatible values and controls remain preserved without changing global provider settings.

V2 loops can omit the active timeout to use the host's timeout. An explicit loop timeout counts active execution across steps and resumes. Existing saved limits are preserved.

## Durability and limits

Definitions, immutable revisions, admissions, attempt evidence and complete outputs use plugin-owned SQLite with locking, transactions, integrity checks and backup support. History pages use an owner-scoped database index; completed and parked runs load individually when requested instead of staying in memory. Legacy JSON is validated and backed up before import; the original file remains. Running definitions are pinned. A draft can change independently of publication.

There is no 20-loop or 50-run retention cap. History and full output have paged retrieval; completed and parked records are indexed and loaded lazily on authorized inspection rather than being kept in the engine cache. Synchronous commit barriers run on the plugin service worker. The recorded bounded workload qualifies its tested scale; larger production-capacity claims remain unmade. Queue concurrency is configurable. Cancelled host work retains its physical execution slot until cleanup settles. Checkpoint retry is distinct from deliberately repeating an uncertain attempt.

Large feature requests use chunked uploads; large results use immutable, conversation-scoped documents with verified Unicode paging. The UI handles both automatically. Agents use `loops_upload` and `loops_document` when a value exceeds the host message envelope. See [transport and operator budgets](docs/TRANSPORT.md).

Local editor drafts persist in browser storage per loop, agent and conversation, including unfinished invalid edits. Concurrent edits can be merged; conflicting fields require a deliberate choice. Archived/deleted definitions are recoverable. The library is Gateway-wide, while run control is tied to the host-resolved conversation generation; independent shared-team principals and new cross-session recovery are post-1.0 host-dependent enhancements. Separate customers must use separate Gateways/state/credentials/workspaces.

[Deployment guidance](docs/DEPLOYMENT.md) covers upgrade, matched backup rollback, disable and uninstall. Uninstalling does not authorize erasing retained definitions or history. The personal assistant and EmbodySense remain outside this plugin's state and execution scope.

Failed runs expose a stable code, phase, failed node, selected model, retryability and a recovery step in the inspector and agent receipts. Commands include the code and recovery guidance. Storage-full, locking, access, corruption and I/O failures have distinct diagnoses. Wrapped provider errors are classified without retaining raw credential, URL or request-body text in shared history. Unrecognized host failures remain generic; classification does not prove that a provider performed no work. Retries remain explicit.

## Contribute and verify

`npm run check` runs types, lint, deterministic tests and both builds. `node scripts/verify-package.mjs` exercises actual SDK adapters from the extracted tarball. Live command/tool/UI tests use dedicated synthetic conversations and record their evidence separately. GitHub CI is configured for macOS/Linux and Node 24.16.0/26.1.0; an unrun workflow is not passing evidence.

See [contribution guidance](CONTRIBUTING.md), [MIT license](LICENSE), and [third-party notices](docs/THIRD_PARTY_NOTICES.md). [Public source](https://github.com/Jacob-J-Thomas/openclaw-loops) and its plugin history are available. Follow [CI](https://github.com/Jacob-J-Thomas/openclaw-loops/actions/workflows/verify.yml) and [delivery status](docs/DELIVERY_STATUS.md); [#76](https://github.com/Jacob-J-Thomas/openclaw-loops/issues/76) records registry availability and fresh installation when complete.
