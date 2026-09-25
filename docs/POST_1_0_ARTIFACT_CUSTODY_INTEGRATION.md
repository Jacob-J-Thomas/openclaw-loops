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

The v5 SQLite custody schema also keeps current `artifact_memory_links` for
artifact references in live owner-scoped Memory values. The Memory CAS batch
updates its record, immutable mutation receipt, and exact artifact links in
one SQLite transaction. Each newly written reference must match a published
custody item byte-for-byte and its owner scope must equal the trusted Memory
row scope. Updating, forgetting, resetting, or retaining a Memory key removes
its former links; another key or run can continue to protect the same item.
GC snapshots and cleanup admission include these links, so explicit run
retention cannot release bytes still referenced by Memory. A foreign,
released, malformed, or changed reference aborts the entire Memory mutation.
Cold admission verifies Memory values, link identities, item publication, and
the link index before opening a writable store.

Schema 4 had no artifact custody authority. During its backed-up migration to
the still-unreleased v5 schema, existing Memory values are preserved as
opaque legacy data, with an immutable provenance receipt bound to each row's
version, value hash, and original JSON.
Even artifact-shaped JSON in those values receives no custody link or grant.
A later v5 Memory update must validate new references and replace live links
in the same transaction. It does not erase the old receipt: authorized
Memory-consume output and its exact copied descendants may need that proof
after the key changes. The current row becomes strict once its version or
value changes. Tampering with a receipt or current link blocks cold writable
admission. This preserves old data without allowing a lookalike value to
claim published artifact bytes.

Run checkpoints from every supported pre-custody schema (1 through 4) receive
separate immutable origin receipts for artifact-shaped ordinary JSON, including
their exact source schema version. Schema 1 has no retired-admission table;
the migration adds it without rewriting the original Run JSON. New Run
admission requires strict custody for
all input references. A run may carry a canonical-JSON-identical legacy
subtree through authored Memory consume/search outputs, return results and
context; the SQL worker verifies the exact owner, loop, Memory row version,
value hash and original receipt before recording that run's opaque origin.
Explicit retry admissions inherit only the same verified origin IDs from
their parent when the exact canonical subtree is still resident in both
parent and new retry state. Cold validation follows the same-owner, pinned
definition and input ancestry to the immutable migration or authored Memory
origin, rejecting a switched origin or a cycle. The current retention policy
keeps the parent Run while its child exists; permitting earlier parent
retirement would need a separate immutable ancestry receipt. Inheritance
occurs at admission, not at later checkpoints, and the origin persists
independently when historical runs are retired. Changed
IDs, owners or digests lose the exemption. This provenance
never constitutes an artifact publication or permission to read file bytes.
Current Engine retention keeps a retry parent while its child remains, then
permits the child and parent to retire in order. The retained origin receipt
does not rely on either run row remaining. That behavior is covered by the
local retry/retention regression; a child-after-parent-retirement run is not
an available public retention transition today.
The current proof collector covers the v5 root node vocabulary on this
candidate; #234/#254 nested frame output paths require a coordinated extension
when those products are integrated.
Migration origins and the original Memory receipts are created once from the
finite pre-upgrade database and are not silently deleted or charged against a
new lower limit. Newly derived Memory/retry Run proofs have a per-owner
retained-state cap of 4,096 rows and 4 MiB of identity/proof metadata.
Admission checks this inside the Run transaction: a quota refusal commits no
Run, link or proof change. Normal Run retention removes its derived proof rows
and restores capacity; immutable migration origins remain available for later
authorized consumes. A cold v5 store with derived rows beyond the cap is
rejected before writable admission. The error directs the owner to retire
settled Run history; no proof is recycled automatically.

The older uncoordinated `put`, `import`, `previewCleanup` and `applyCleanup`
remain preparatory core primitives for focused tests; the installed engine
must use the coordinated methods. The core deliberately makes no SQLite
schema-version claim or migration edit. The persistence owner supplies the
durable reservation/link/GC-lease seam in its assigned serial migration; the
graph/editor/public operation owners will wire typed references, byte
transport and host authority separately. Until those seams and installed-host
tests exist, this core does not satisfy Bolt #276.
