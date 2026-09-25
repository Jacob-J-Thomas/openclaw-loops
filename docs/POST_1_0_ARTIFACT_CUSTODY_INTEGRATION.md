# Bolt #276 artifact custody integration seam

`ArtifactCustody` is a preparatory plugin-owned binary store. It is separate from
`DocumentStore`, which transports JSON results and uploads. The caller supplies
already-authorized bytes and a trusted absolute plugin-owned root. Public request
data must not choose a source or destination filesystem path. A reference is an
opaque identifier with digest, length, MIME, owner-scope digest and run/node
provenance; it is never an authority grant. Every operation requires the current
host-authorized owner, and the bridge must recheck host authority before invoking
the core. The owner digest uses a framed JSON tuple of agent, session key and
session generation; the original owner fields and credentials are absent from
portable manifests.

The core stores immutable base64-encoded binary records, with metadata and bytes
in the same file. A single artifact or multi-artifact import is staged in a
private directory and published with one directory rename after file flushes.
Generated names and no-follow checks on store entries prevent artifact IDs from
becoming paths. Each synchronous custody operation holds `BEGIN EXCLUSIVE` on
the stable private `.custody-owner.sqlite` file, serializing reads, writes,
imports, quota checks, recovery inspection and cleanup across processes. The
OS releases that transaction when its process dies, including after SIGKILL;
the stable file is never unlinked, so competing recoverers cannot steal one
another's lock. A remaining legacy `.custody-lock` directory has no verifiable
owner identity and stays fail-closed for explicit operator inspection. An
unresolved staging directory likewise requires explicit reconciliation;
neither it nor uncertain bytes are silently replayed or deleted.
Commit failure after rename reports an uncertain outcome and preserves the
published data for readback. Cleanup reports partial deletion and requires a new
preview if I/O fails.

`export` marks every dependency `embedded` or `external`. Import validates the
whole bundle and every supplied external byte dependency before publishing any
artifact. Missing or corrupt external dependencies fail; a manifest alone does
not claim portability. Imported artifacts receive fresh opaque IDs and bind to
the authenticated receiving owner and caller-supplied run/node. Source IDs and
provenance in the bundle are explanatory only. The core never dereferences
external paths, inherits grants, or executes artifact contents.

`withCoordinationLease(callback)` holds the same private file lock across
synchronous SQLite calls and nested custody operations. `putCoordinated` and
`importCoordinated` precompute all new opaque references, call `reserve(refs,
operationId)` while no file is published, atomically publish the file batch,
then call `published(refs, operationId)`. The SQL owner stores reservations
durably before the rename. It must keep reserved and published IDs protected
even without a run row; a later engine transaction links the published IDs to
the run checkpoint. A callback or file failure after reservation returns an
uncertain result and leaves the reservation for explicit inspection. Neither
the file rename nor the SQL transaction makes the two stores jointly atomic.

For recovery, the SQL owner first verifies current owner/source authority and
reads the exact reserved references for one operation ID through
`artifactOperation(owner, operationId)`. It passes those IDs
to `inspectRecovery(owner, reservedIds)`, which reports each as validated
`published`, validated `staged`, `missing`, or `uncertain` without returning a
path or changing any bytes. The SQL `artifactCleanupLease(owner)` inspector
exposes any unresolved cleanup lease; these durable inspectors guide an
explicit owner decision to link, retain or repair. An unresolved staging
directory blocks new publication and GC, but authorized committed reads and
metadata pages remain usable. The core never auto-replays publication or
discards staged bytes or SQL intent. Malformed staging remains for operator
inspection; no result claims an unverified artifact was published.

For cleanup, `previewCleanupCoordinated` obtains an advisory protected-ID
snapshot under the custody lock. `applyCleanupCoordinated` obtains a fresh SQL
GC lease and protected-ID snapshot through `begin`, rechecks the plan, deletes
and reads back files under the same custody lock, then passes the receipt to
`finish` for SQL disposition and lease release. SQL must refuse GC while any
reservation is unresolved and must prevent reference or run-checkpoint writes
while the GC lease is active. Protected IDs include active, parked,
cleanup-pending, uncertain and interrupted runs. A failure after `begin` leaves
the durable GC lease for explicit reconciliation, even when no file was
removed. Neither side silently clears pending intents or GC leases.

The older uncoordinated `put`, `import`, `previewCleanup` and `applyCleanup`
remain preparatory core primitives for focused tests; the installed engine
must use the coordinated methods. The core deliberately makes no SQLite
schema-version claim or migration edit. The persistence owner supplies the
durable reservation/link/GC-lease seam in its assigned serial migration; the
graph/editor/public operation owners will wire typed references, byte
transport and host authority separately. Until those seams and installed-host
tests exist, this core does not satisfy Bolt #276.
