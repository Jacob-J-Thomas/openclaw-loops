# Bolt #275 opt-in memory

Loops memory is plugin-owned SQLite data, not the host's native memory slot.
The external plugin never reads the host's memory files or personal profile.
Nothing is read or injected into a prompt by default. A saved version 3 loop
must enable a memory policy and author a Memory node before it can access a
key. Draft and unpublished test execution cannot read or write memory.

An absent policy or `{version:1,enabled:false}` disables memory. An enabled
policy lists each node's read, write and forget/reset key prefixes. Write
prefixes select a versioned recursive JSON schema and retention duration.
Schemas are immutable once saved; changing validation rules requires a new
schema version. The engine obtains owner, loop revision, run, node and grant
generation from the current saved admission. Imported JSON and public calls
cannot supply those values. Every operation checks the current session and
Loops grant, and commits use a synchronous compare-and-swap through one SQLite
worker. A different agent or conversation has a different owner scope.
An operator with read-only access to the same conversation may inspect its
authorized run history and authored memory query results. A Memory write,
update, forget or removal apply requires an exact plugin-owned run grant
issued when a host-admitted agent tool or operator-write action starts the
saved loop. The grant pins the run ID, conversation owner, loop revision,
grant generation and authored policy digest. The engine rechecks that grant,
the current session, plugin enablement and Loops publication before the final
synchronous storage commit. Read-only admission cannot mint the grant.

Native tools use the public version 2 invocation assertion at each write and
stay awaited through queued execution and physical settlement. An owner
command uses the host's current-owner assertion when provided. The Control UI
keeps its inspectable running handle after ten seconds while a separate host
session work admission stays awaited through plugin-observable settlement;
later plugin-owned memory effects use the exact admitted run grant and current
Loops/session checks. That grant is authority for this plugin's own memory only. The
bridge snapshots the trusted session `lifecycleRevision` when it constructs an
actor and compares it again before work admission, after the host admission
await, and at joined effect checks. A reset that keeps the session ID but
changes its lifecycle blocks a stale actor from dispatching effects; a newly
current invocation can still act. Historical read ownership remains the
agent, session key and session ID tuple. If a legacy session entry omits the
optional revision on both reads, this plugin cannot infer a reset from it;
the public host work admission and its other current-invocation checks still
apply. The released session-action context cannot recheck the original operator's host
profile permission after the action returns, so the plugin does not claim
later effects are still authorized by that person or by a durable host grant.
Gateway-scoped commands are admitted by the host's registered write scope and
remain awaited for effects, but the released command context supplies no
separate profile-revocation callback for those clients.
Parked runs stop physical work; Continue is a fresh host admission.
Settlement here means the plugin's worker and host-call promise have finished;
it does not prove that a remote model provider has stopped processing.

The Memory node supports consume, search, inspect, write, update, forget,
mutation receipt lookup, retention preview/apply and reset preview/apply.
Write starts at version zero; update and forget require an expected version.
Preview returns a plan ID. An apply node can bind that ID from a previous
preview node, such as `{{nodes.preview.planId}}`; it recomputes the plan and
rejects any changed inventory before atomically tombstoning the candidates.
Search is lexical and paged. It does not use embeddings, provider calls or
automatic consolidation. Memory node outputs enter a prompt only if another
node explicitly binds them.

The public `loops_memory` query and matching UI/command operation inspect a
retained run's authored Memory node. They support consume, inspect, search,
mutation receipt lookup and removal previews. Writes and removal applies run
only through saved authored graph nodes. Run inspection shows the pinned
mutation ID and offers exact receipt lookup. A mutation committed before a
later run checkpoint fails is marked uncertain; inspect the receipt and key
before an explicit recovery. The effect never replays automatically.

The [persistence contract](POST_1_0_MEMORY_PERSISTENCE.md) details quotas,
schema migration, restart validation and durable receipts. Local tests exercise
real SQLite write/read across runs and restart, owner denial, reset tombstones
and failed-checkpoint receipt lookup. Installed external-plugin verification,
platform gates and independent review remain separate acceptance evidence.
