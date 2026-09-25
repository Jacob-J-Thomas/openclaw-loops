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
cannot supply those values. Every operation checks current host and loop
authority, and commits use a synchronous compare-and-swap through one SQLite
worker. A different agent or conversation has a different owner scope.

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
