# History and explicit cleanup

History is retained by default. The native run inspector pages through 100 runs at a time; `loops_history` supports pages of up to 1,000. No limit on history length implicitly deletes a run. Alpha.15 reads history pages through the SQLite owner/time index. Completed and parked runs stay on disk until an authorized inspection, output request or continuation needs that individual run. Startup loads unfinished execution/cleanup records, definitions and revisions; it does not retain complete historical outputs in the engine or worker.

The compatibility `loops_runs` operation still returns all compact summaries for the conversation. Explicit cleanup scans compact metadata across retained history to protect recovery ancestry. Individual full-run inspection materializes that run, and worker commits still have a synchronous acknowledgement barrier. These are bounded improvements to history loading, not a claim of unlimited storage or constant-time operations.

Use **History cleanup** in the run inspector, or `loops_retention`, when deletion is wanted. Configure an age threshold, a minimum number of newest runs to keep, or both. When both are supplied, a run must be older than the age threshold and outside the retained newest group before it becomes eligible. Age is measured from the last saved run update; the newest group is ordered by creation time and ID. Blank controls impose no additional age/count condition. At least one control must be supplied.

Preview returns eligible IDs, a plan ID and protected counts. Applying the same policy with that plan ID deletes that unchanged candidate set. A changed candidate set requires another preview. This is available to authorized agent tools and operators with write access; no additional human-only permission applies. Read-only operators cannot delete history.

Queued, running, waiting and review runs are protected. Cancelled or failed runs remain protected while logical or physical execution is settling. Any run referenced by another retained run's recovery ancestry is protected, even when that child is itself eligible. Cleanup is scoped to the invoking conversation. It does not delete loop definitions, revisions or another conversation's history.

Removal atomically deletes the run, attempt records, outputs and state-transition events. A small immutable admission tombstone keeps its request ID and fingerprint reserved across restart. Reusing that request ID returns `LOOPS_HISTORY_REMOVED`; it never repeats the old execution. Supply a new ID only when a new execution is intentional.

Deletion here is not secure erasure. SQLite can reuse released pages; immutable transport documents, staged uploads, retained backups and original legacy JSON remain separate copies. No automatic compaction, document garbage collection or backup deletion is performed. Those storage-maintenance capabilities remain tracked release work.

## SQLite upgrade

Alpha.6 uses SQLite schema 2. A schema 1 database receives a verified, private `loops.sqlite.before-schema-2-<timestamp>.bak` snapshot before the migration transaction creates admission tombstones. Existing definitions and runs are preserved. The graph schema remains independent: existing version 1 and version 2 graphs keep their execution semantics.

An older artifact that supports only database schema 1 must be restored with its matching backup. See [deployment and rollback](DEPLOYMENT.md). A failed write rolls back visible state to the last committed records and aborts current execution. If readback also fails, the engine stops serving unverified state until the plugin is restarted and recovery inspects the saved attempts.
