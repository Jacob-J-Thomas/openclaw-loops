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

The editor selects a **Run target** explicitly: the published revision or the
current draft. Published execution uses that revision's slug and input schema,
including while a newer draft is unsaved or invalid. Draft testing uses the
draft's inputs without changing publication. Each target keeps separate input
values; changing loops or input schemas initializes the corresponding form
again. Compatible input values survive saving or publishing another revision. Optional omission, explicit zero and false retain their meaning.

**Save draft** preserves publication. **Save & publish** saves and activates the
edited draft; **Publish rN** activates a saved revision. **Disable new runs** and
**Enable published rN** control the selected publication without replacing local
draft edits. Historical publication also preserves those edits. Version restore
explicitly creates a new draft, and the editor asks before replacing unsaved
edits with that restored draft. Existing runs retain their admitted definitions
and settings under the current host and loop authority rules.

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

Each nondeleted loop reserves its current draft slug and, when enabled, its
published revision's slug. Saving, publishing a historical revision, enabling
and recovering use the same reservation check. A conflict returns
`LOOPS_SLUG_CONFLICT` before changing revisions, activation or saved state. A
disabled current draft still reserves its name; a disabled historical
publication does not. Another revision of the same loop may reuse its own slug.

Older artifacts could admit two enabled publications with one slug. Those
records remain readable by ID; new `describe`/`run` requests for the ambiguous
slug return `LOOPS_AMBIGUOUS_SLUG` instead of selecting an arbitrary loop. Disable
one publication or explicitly edit and publish it under an available name, then
retry. No automatic renaming or history rewriting occurs. Existing run IDs and
matching admission retries keep their pinned definitions and remain subject to
current permissions; they do not select a new publication by slug.

`run`, `test` and `retry` share a conversation-scoped request-ID namespace. Reuse
an ID for a retry of the same request; choose a new ID only for an intentional
new execution. Duplicate admissions return the original run without dispatching
again, including after restart. Changed input, unpublished definition, recovery
parent or recovery mode conflicts with that ID. Object key order is immaterial;
array order, scalar types and distinct Unicode key spellings remain significant.
The fingerprint comparison is independent of the Gateway's locale. A different
invocation surface does not change an explicit ID's scope or payload contract.
The legacy `--request-id X` text shortcut uses `command:X`; the JSON
`requestId` field passes through unchanged on every surface.

Each editor Run/Test/recovery action creates a new ID. Commands generate an ID
for a new invocation unless one is supplied. Tools use their host tool-call ID
when the explicit ID is omitted; a new tool call is a new intentional request,
so agents should supply the original request ID when retrying uncertain delivery.
These IDs prevent duplicate plugin dispatch, not duplicate remote side effects
after an uncertain host-call outcome. Recovery remains an explicit new admission.

New runs pin `requestFingerprintVersion:2`. Existing run hashes are immutable;
retained legacy requests are also compared against their saved payload. When
legacy history is removed now, its tombstone preserves an additional canonical
hash before deleting that payload. IDs removed by an older artifact remain
reserved: their discarded payload cannot be reconstructed, so an equivalent
request reordered across Unicode keys/locales may report a conflict instead of
`LOOPS_HISTORY_REMOVED`. Neither response starts work. See
[upgrade and rollback](DEPLOYMENT.md) for the database-version boundary.

All operations reject unrecognized caller-identity fields before dispatch and
recheck current host authority. A revoked plugin cannot continue serving a tool
factory created earlier. A stopped service returns `LOOPS_SERVICE_UNAVAILABLE`;
it must not present an empty library or successful mutation. Schema, conflict,
publication, ownership and transition errors retain their existing contracts.
The command surface renders operation errors as `Loops [code]: ...`, followed by
phase, available node/model attribution, retryability and a next recovery step.
Legacy failed-run shortcuts retain the run's failed state and the same diagnostic
fields. Feature/tool callers receive the typed error contract. The editor uses
that contract in operation, library, capability, history-cleanup and run alerts;
local input errors without host diagnostics remain plain messages. Unavailable
node/model attribution is omitted, never inferred. Retryability is guidance for
an explicit recovery request, not an automatic replay of a failed host call.

Only public diagnostic fields are presented. Native causes, provider request
bodies, credentials, filesystem paths and arbitrary error properties are not
expanded into alerts or conversation replies. Large replies, including typed
operation failures, use the [complete transport protocol](TRANSPORT.md).

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
