# Loops interface contract

The editor, `/loops` commands and `loops_*` agent tools use one typed feature
contract. There are 34 public operations and 33 agent tools. `review` records an
explicitly authored Human review decision and is the sole operation without an
agent tool. Agents may author, enable, invoke, inspect, cancel and recover loops.

Full-definition `save` is available as `loops_save`, including its existing
optimistic concurrency behavior. Supply the complete editable definition, its
current ID and `expectedRevision`. `enabled:true` saves and enables atomically;
false **or omitted** saves a disabled revision. Use `draft` to preserve a current
publication while editing. `create` enables by default and `edit` preserves
activation by default. None of these operations can impersonate Human review.

The table inventories semantic operations, not one button per operation. For
example, copying/importing a graph uses save/create, the editor retrieves full
documents automatically, and its run browser uses paged history. Graphical
authoring, keyboard, recovery and responsive journeys have separate acceptance
under R19–R23; calling an action handler alone is not browser evidence.

| Shared operation | Agent tool | Behavior to verify |
|---|---|---|
| `browse` | `loops_browse` | Search active/runnable/recoverable definitions; follow stable cursors. |
| `library` | `loops_library` | Read saved definitions including disabled drafts. |
| `list` | `loops_list` | Discover authorized enabled publications. |
| `load` | `loops_read` | Read the complete current definition and publication record. `/loops read` is an alias. |
| `describe` | `loops_describe` | Inspect a runnable publication and its required inputs. |
| `capabilities` | `loops_capabilities` | Inspect selected model, settings descriptors, budgets and unknown support. |
| `validate` | `loops_validate` | Validate without saving or invoking. Invalid graphs produce issues. |
| `create` | `loops_create` | Create enabled by default, or explicitly disabled. |
| `save` | `loops_save` | Replace a complete definition with optimistic concurrency. |
| `edit` | `loops_edit` | Replace requested fields; preserve activation unless explicitly changed. |
| `draft` | `loops_draft` | Save a revision while retaining publication. |
| `versions` | `loops_versions` | Read immutable definitions and publication state. |
| `publish` | `loops_publish` | Activate an exact validated revision. |
| `restore` | `loops_restore` | Create a new draft from a prior revision. |
| `enable` | `loops_enable` | Enable or disable new starts; no human-only activation. |
| `revoke` | `loops_revoke` | Disable and prevent further dispatch under revoked grants. |
| `run` | `loops_run` | Invoke the actual saved publication with explicit retry identity when needed. |
| `test` | `loops_test` | Invoke an unpublished definition without changing publication. |
| `status` | `loops_status` | Read a compact truthful run receipt, including pending/failure states. |
| `runs` | `loops_runs` | Read conversation run summaries. |
| `history` | `loops_history` | Read complete history through pages. |
| `inspect` | `loops_inspect` | Read pinned definitions, outputs, attempts and execution evidence. |
| `output` | `loops_output` | Retrieve complete output with Unicode continuation offsets. |
| `resume` | `loops_resume` | Continue a manual Wait; refuse to approve Human review. |
| `cancel` | `loops_cancel` | Stop further dispatch and expose cleanup state. |
| `retry` | `loops_retry` | Recover explicitly with original-run ancestry. |
| `review` | None | Authenticated human approve/reject, only for an authored review node. |
| `archive` | `loops_archive` | Hide/unhide a definition while preserving evidence. |
| `deleted` | `loops_deleted` | Discover authorized archived/deleted definitions. |
| `recover` | `loops_recover` | Restore a definition as disabled. |
| `delete` | `loops_delete` | Delete the requested definition at the expected revision; protect open runs. |
| `retention` | `loops_retention` | Preview cleanup, then apply that unchanged candidate plan. |
| `upload` | `loops_upload` | Stage and verify input before an authorized operation consumes it. |
| `document` | `loops_document` | Retrieve immutable complete results and verify their digest. |

## Common negative and unavailable cases

All operations reject unrecognized caller-identity fields before dispatch and
recheck current host authority. A revoked plugin cannot continue serving a tool
factory created earlier. A stopped service returns `LOOPS_SERVICE_UNAVAILABLE`;
it must not present an empty library or successful mutation. Schema, conflict,
publication, ownership and transition errors retain their existing contracts.
The command surface renders operation errors as `Loops [code]: ...` plus recovery
text; feature/tool callers receive typed errors. Large success responses use the
[complete transport protocol](TRANSPORT.md).

Published runs pin an opaque `grantGeneration` from their loop record. Explicit
revoke rotates that generation, so re-enabling or republishing cannot restore an
older admission's revoked authority. Ordinary draft/save/edit/publication and
disable operations preserve existing grants. These fields are runtime metadata;
definition authoring cannot set them. Every dispatch still checks current host
and conversation authority. An already dispatched host call may finish after
revocation; its completion does not authorize another node to dispatch.

To recover explicitly, cancel a revoked parked run and use `loops_retry` with a
new request ID, or start a new run, after current loop and host permissions allow
it. Recovery creates a separately authorized admission linked to the original;
it never revives the original grant. Agents retain those controls. Unpublished
tests keep their existing author-authority path, and Human review decisions
remain separately authenticated. See [upgrade and rollback](DEPLOYMENT.md) for
the legacy grant migration and matching-backup requirement.

`scripts/verify-grant-lifecycle.mjs <disposable-profile> feature|command|agent prepare|finish <evidence-directory>` qualifies this lifecycle through an ordinarily installed Gateway. Run `prepare`, stop and restart that dedicated Gateway with a matching stopped-state backup, then run `finish` against the same evidence directory. Feature and command journeys cover Wait and Human review through publication, disable, revoke, new admission and explicit recovery. The agent journey uses actual requested tool calls on a revoked Wait; it does not synthesize human decisions. The script preserves operation/chat receipts and never automatically retries a failed mutation. Record the external Gateway restart and installed artifact separately. These nodes read configured-model metadata; they do not prove inference transport or provider cancellation.

The adapter inventory exercises every operation through actual registrations
from the public OpenClaw feature SDK: successful lifecycle transitions, identity
injection, plugin revocation and service unavailability. It checks disabled-run
rejection, immutable revision/publication behavior, full save conflicts, staged
UTF-8 input, complete oversized documents, manual waits, cancellation/retry
ancestry, Human review separation and archive/recovery/deletion. These automated
tests use fixture host capabilities and no real model completion; source and
extracted-package runs remain distinct from installed-runtime evidence.

Stable principals across conversation reset, account-bound completion,
unsupported sampling controls, durable requester-bound delivery and durable
abort depend on the [public SDK requirements](UPSTREAM_REQUIREMENTS.md). A test
of local plugin revocation or an operator-admin session is not proof of those
missing host contracts or all shared-team roles.

## Installed-runtime qualification

Run against an explicitly selected **disposable** loopback Gateway profile with
the candidate installed through ordinary plugin installation:

```sh
node scripts/verify-interface-parity.mjs /path/to/disposable/profile feature
node scripts/verify-interface-parity.mjs /path/to/disposable/profile command
node scripts/verify-interface-parity.mjs /path/to/disposable/profile agent
```

Each journey creates a fresh conversation and uniquely named synthetic loop. It
uses the current configured model; it does not replace model/account/tool policy.
`feature` exercises actual public Gateway session actions, `command` uses real
`chat.send` slash commands, and `agent` requests actual discovered tools from the
model and verifies their recorded tool reports. Loop execution in this lifecycle
journey uses deterministic echo/Wait/review nodes. Only `agent` invokes a model.
It does not claim inference-node parameter forwarding or browser interaction.

The agent journey expects exactly one recorded result per requested tool. It
preserves unexpected/missing calls and stops without blindly repeating a
mutation. Human approval in that journey is a separate authenticated session
action, explicitly recorded and never attributed to the model. The script
removes its own synthetic definition after success and preserves run evidence.

Private receipts are written under ignored `evidence/interface-parity` by
default (`LOOPS_EVIDENCE_DIR` can select another private evidence directory).
Record the source, installed artifact, OpenClaw and Node versions alongside
them. Exact-output and browser evidence from other acceptance runs must retain
their own identities; unchanged code can be reused only with an equivalence
check. This script does not mark a release accepted.
