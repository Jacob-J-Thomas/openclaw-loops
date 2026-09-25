# Plugin-owned memory persistence

Bolt #275 adds a synchronous `MemoryRepository` port on the existing SQLite
worker. The worker is the only writer; the caller's `SqliteStorage.call` waits
for a committed reply. A timed-out or lost reply is uncertain. The caller must
look up the mutation ID and must not replay the mutation automatically.

## Schema and migration

From the current feature database at `PRAGMA user_version=3`, schema 4 adds
`memory_records`, `memory_mutations` and `memory_receipts`. Their keys are
respectively `(owner scope, loop ID, key)`, `(owner scope, loop ID, mutation ID)`
and `(owner scope, loop ID, mutation ID, receipt ordinal)`. The owner scope is
the SHA-256 digest of the trusted agent/session tuple supplied by MemoryCore.
Rows retain full value provenance or immutable receipts. A forget, reset or
retention operation writes a higher-version tombstone; it does not erase the
prior mutation receipt. General whole-state writes do not replace memory rows.

Startup reads the WAL-aware database through a read-only handle and rejects
unknown schema versions, malformed memory tables, indexes, foreign keys, JSON,
row identities, value digests and receipt sequences before acquiring a writable
handle. Migration creates a mode-0600 SQLite backup, verifies its source schema
and `quick_check`, then adds tables and advances the schema version in one
transaction. A failed migration rolls back without changing existing records.
Rollback is a matched restore of the pre-migration database and profile files
with the matching older plugin; no in-place downgrade is attempted.

## Atomic commit and quotas

`commitBatch` checks a new mutation ID, distinct keys, exact expected versions,
provenance, value digests, and the post-batch key and value-byte totals under
`BEGIN IMMEDIATE`. It updates all records and inserts the ordered immutable
receipt set before committing. A conflict or quota failure changes none of
them. Reads and pages are scoped to owner plus loop and ordered by key.

`maxMutations` and `maxReceiptBytes` bound effect writes and updates per owner
plus loop. Each effect receipt reserves one later cleanup mutation and 2048
bytes of cleanup receipt space. This finite reserve lets a live value be
forgotten when an effect quota is full. Cleanup includes forget, explicit
retention and reset. A cleanup still needs a live prior version, the current
authorized preview and compare-and-swap version; the reserve cannot create an
unbounded sequence of tombstones. Existing mutation IDs and receipts are never
silently pruned. When a quota is exhausted, a new effect fails with
`LOOPS_MEMORY_QUOTA`; operator action or a separately reviewed retention
contract is needed to expand that owner-loop budget.

The saved loop policy, graph node, public read/inspection operations and trusted
versioned schema resolver are integrated with this port. An installed external
host authorization journey remains separate acceptance work.
