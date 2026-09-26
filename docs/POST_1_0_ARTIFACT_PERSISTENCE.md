# Bolt #276 SQLite custody seam

This preparatory migration follows memory schema v4 and tentatively allocates
schema v5. The integration owner must confirm the version against the actual
feature-branch baseline before admitting a PR. The migration takes a verified
mode-0600 SQLite backup, preserves every existing table and identity, and
validates both memory and artifact tables before acquiring a writable handle.
Unknown artifact tables under an older schema and malformed rows, links,
indexes, foreign keys or receipts fail closed. A failed constructor terminates
its worker before releasing the owner lease.

`artifact_operations` and `artifact_items` durably reserve exact owner-scoped
reference IDs and metadata before the custody core publishes a file batch.
`ArtifactCustody.putCoordinated` and `importCoordinated` hold the core's
reentrant directory lock while calling `artifactReserve`, publishing the batch,
and calling `artifactPublished`. A failure after reservation remains an
inspectable operation; it is not retried or discarded automatically. Pair
`artifactOperation(owner, operationId)` with the core's
`inspectRecovery(owner, reservedIds)` under current host authorization to
distinguish published, staged, missing and uncertain bytes. A SQLite commit and
a directory rename are separate durability domains; this protocol does not
claim a cross-filesystem transaction.

`artifact_links` records each run/node use. Every `writeRun`, whole-state write
and retention removal reconciles links inside the same SQLite transaction as
the run checkpoint. Ordinary JSON stays data even if it contains a
`kind: "loops-artifact"` business object. Only a canonical-exact, published
reference in the current owner scope acquires a custody link; unknown, changed
and foreign lookalikes confer no artifact authority. Explicit artifact inputs
and Artifact-node outputs require valid published custody, including on direct
storage writes. Cold admission verifies active links in both directions.
Completed history may retain an exact retired reference with its previously
inactive link, without reviving it. Reserved or published references that have never
been linked stay protected. Unlinked history is retained as inactive link
rows. The engine/public bridge must put artifact references into the persisted
run input, context, outputs or result, then use the existing checkpoint path;
an unpersisted in-memory reference is not a durable link. Host authorization
must be checked again before artifact reads or writes.

A published capture that is never attached to a run otherwise remains
protected indefinitely. The explicit owner-scoped
`artifactReleaseUnlinked(owner, id, operationId, at)` CAS may release only an
exact published standalone upload whose immutable origin is
`capture-${operationId}`/`upload`, has no run row or current/historical run
link, and has no cleanup lease. It records an immutable `releasedAt` on the item, is idempotent
before cleanup, and makes that file eligible for a later ordinary cleanup.
`artifactReferenceStatus` exposes current status for public read/list and run
admission; a released reference cannot be attached to a run. Reserved or
uncertain publications are never released automatically. The caller must
hold the custody coordination lock and check current trusted authorization.

Cleanup uses `previewCleanupCoordinated` with a SQLite protected-ID snapshot.
`applyCleanupCoordinated` obtains a fresh snapshot and durable
`artifact_gc` lease with the exact preview plan under the same directory lock.
Cleanup admission refuses unresolved publication reservations. The snapshot protects
reserved/unbound references and links in queued, running, waiting, review or
interrupted runs, plus runs with pending work, nonempty uncertainty or
`cleanupPending`. While the lease exists, every run and whole-state writer and
new artifact admission rejects rather than changing the protected set. After
the core deletes and reads back files, `artifactFinishCleanup` marks exact
references retired, retains a cleanup receipt, and releases the lease. A
failure or crash leaves the lease visible through `artifactCleanupLease`; it
is not silently reclaimed.

The same explicit, current-owner-authorized recovery operation may be invoked
by a human or an agent. The public bridge must derive owner identity from
trusted host context; a client cannot supply a custody readback. Under
`withCoordinationLease`, it obtains the exact reserved references from
`artifactOperation`, asks the core `inspectRecovery` about those IDs in chunks
of at most 100, and calls `artifactRecoverPublication` with a fresh recovery
ID. SQLite compares every ID and metadata field in one transaction. All exact
published bytes can be acknowledged without replay; all missing bytes become
audited `abandoned` references that cannot be republished. A mixed,
staged, corrupt, foreign or changed readback keeps the reservation blocked.
The original IDs, metadata and immutable recovery receipt remain available.
`artifactOperationsPage` enumerates operations for explicit inspection.

For an unresolved cleanup, `artifactCleanupLease` returns the exact token and
stored plan. Under the same custody lease, the bridge pages every live
reference through `artifactRecoveryInventory`, calls `inspectRecovery` in
bounded chunks, then calls `artifactRecoverCleanup` with an exact full
readback. SQLite refuses missing noncandidates, staged/corrupt/changed bytes,
a changed lease token or incomplete inventory. It retires only confirmed
missing candidates, leaves present candidates in custody, and retains an
immutable recovery receipt: `aborted` (none missing), `partial`, or
`all_absent`. `all_absent` records observed absence; it does not assert that
the interrupted cleanup performed every deletion. No recovery call deletes
files. Normal completed cleanup has its separate receipt under
`artifactCleanupReceipt`. A partially reconciled run needs a fresh preview
before any further deletion. A missing protected file remains blocked for
inspection and matched restore; the SQL worker never repairs files or clears
that lease automatically.

Immutable metadata has finite per-owner lifetime limits: 4,096 operation IDs
and 1 MiB of operation identities,
16,384 reference rows and 64 MiB of reference JSON, 256 simultaneous
reserved/published references, 65,536 historical run links and 64 MiB of
link identities, and 21,504 cleanup/recovery receipts totaling 64 MiB.
Each admitted reference JSON is at most 4 KiB. Admission keeps one potential
publication recovery receipt per reserved reference (8 KiB each), 1,024
receipt slots and 4 MiB of cleanup settlement capacity unspent. GC begins
only with at least one eligible candidate and reserves its receipt capacity
before any file deletion. Repeated empty previews remain read-only; attempted
empty cleanup creates no lease or receipt. The worker validates the hard caps
on reopen and rejects new admissions with `LOOPS_ARTIFACT_QUOTA` before a
partial SQL write. An admitted publication or cleanup can still settle at an
admission cap. Completed operation IDs, references, inactive links and audit
receipts are not pruned or recycled, even after files are removed; once a
lifetime cap is reached, further capture requires a separately reviewed
export/retention migration. Repeated nonempty aborts can exhaust the finite
audit budget; new cleanup then refuses before filesystem mutation while
existing leases retain their settlement reserve and inspection path.

Focused real-SQLite tests cover v4→v5 backup with live memory, failed-open
worker/lease release, corrupt indexes and mismatched run links, reservation
before publication, post-rename acknowledgement loss, cross-owner isolation,
faulted checkpoint rollback, parked/uncertain protection across restart,
and cleanup lease/readback. Recovery tests cover exact publication
acknowledgement, all-missing abandonment, restarted partial cleanup,
parked-reference preservation and refusal of missing noncandidates. These
tests also prove never-linked release, operation-cap refusal, cleanup at that cap, restart readback
and no receipt growth from repeated empty cleanup. They establish the storage
protocol only.
Graph/editor transport, installed-package authorization and real run restart
acceptance remain separate #276 work.
