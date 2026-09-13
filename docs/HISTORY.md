# History and explicit cleanup

## Loop library pages

The Library and its archived/deleted recovery list search the complete selected view and display 50 records per page. Paging and searching preserve the current editor and its recoverable edits; selecting a different loop resets run-input values. Search matches names, slugs and descriptions without case sensitivity.

Agents and conversation commands use `loops_browse` or `/loops browse {"search":"research","limit":50}`. `view:"active"` includes published loops and disabled drafts; `view:"runnable"` shows currently authorized published revisions; `view:"recoverable"` shows archived/deleted records under author authority. A draft's renamed fields do not replace the published definition in the runnable view. The legacy `loops_library`, `loops_list` and `loops_deleted` operations retain their array results.

Follow `nextCursor` until it is null. Records have stable ID ordering; each opaque cursor is bound to its conversation, normalized search, view and visible definition/publication versions. A changed library or permission-filtered result returns `LOOPS_LIBRARY_CHANGED`; restart without a cursor instead of skipping or duplicating changed records. The UI refreshes from the first page while preserving its editor. Page size defaults to 50 and supports 1–1,000 records. There is no total-count limit or implicit deletion. Pagination bounds retrieval/DOM size; definitions and revisions still reside in the engine and filtering scans that library.

## Run history

History is retained by default. The native run inspector pages through 100 runs at a time; `loops_history` supports pages of up to 1,000. No limit on history length implicitly deletes a run. Alpha.15 reads history pages through the SQLite owner/time index. Completed and parked runs stay on disk until an authorized inspection, output request or continuation needs that individual run. Startup loads unfinished execution/cleanup records, definitions and revisions; it does not retain complete historical outputs in the engine or worker.

The compatibility `loops_runs` operation still returns all compact summaries for the conversation. Explicit cleanup scans compact metadata across retained history to protect recovery ancestry. Individual full-run inspection materializes that run. The engine and SQLite commit acknowledgements now run behind an asynchronous service worker: a blocked database write queues other Loops operations while the Gateway thread remains available. Reads and mutation replies retain the engine's committed-state ordering. Definitions, revisions and individual inspected runs still require memory; pagination does not imply unlimited storage or constant-time operations.

Use **History cleanup** in the run inspector, or `loops_retention`, when deletion is wanted. Configure an age threshold, a minimum number of newest runs to keep, or both. When both are supplied, a run must be older than the age threshold and outside the retained newest group before it becomes eligible. Age is measured from the last saved run update; the newest group is ordered by creation time and ID. Blank controls impose no additional age/count condition. At least one control must be supplied.

Preview returns eligible IDs, a plan ID and protected counts. Applying the same policy with that plan ID deletes that unchanged candidate set. A changed candidate set requires another preview. This is available to authorized agent tools and operators with write access; no additional human-only permission applies. Read-only operators cannot delete history.

Queued, running, waiting and review runs are protected. Cancelled or failed runs remain protected while logical or physical execution is settling. Any run referenced by another retained run's recovery ancestry is protected, even when that child is itself eligible. Cleanup is scoped to the invoking conversation. It does not delete loop definitions, revisions or another conversation's history.

Removal atomically deletes the run, attempt records, outputs and state-transition events. A small immutable admission tombstone keeps its request ID and fingerprint reserved across restart. Reusing that request ID returns `LOOPS_HISTORY_REMOVED`; it never repeats the old execution. Supply a new ID only when a new execution is intentional.

Deletion here is not secure erasure. SQLite can reuse released pages; immutable transport documents, staged uploads, retained backups and original legacy JSON remain separate copies. No automatic compaction, document garbage collection or backup deletion is performed. Those storage-maintenance capabilities remain tracked release work.

## SQLite upgrade

The admission-identity update uses SQLite schema 3. A schema 1 or 2 database receives a verified, private `loops.sqlite.before-schema-3-<timestamp>.bak` snapshot before migration. Existing definitions, runs and admission hashes are preserved. New admissions use locale-independent fingerprints; retained legacy payloads receive an additional canonical tombstone hash when removed. IDs already removed by an older artifact remain reserved even when discarded payloads cannot establish equivalence. Schema 1 also gains the admission-tombstone table introduced in alpha.6/schema 2. The graph schema remains independent: existing version 1 and version 2 graphs keep their execution semantics.

An older artifact that supports only database schema 1 or 2 must be restored with its matching backup. See [deployment and rollback](DEPLOYMENT.md). A failed write rolls back visible state to the last committed records and aborts current execution. If readback also fails, the engine stops serving unverified state until the plugin is restarted and recovery inspects the saved attempts.
