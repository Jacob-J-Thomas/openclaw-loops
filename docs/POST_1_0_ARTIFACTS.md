# File artifacts in Loops

Version 3 definitions can declare an `artifact` input and an Artifact node. The
Run panel captures a file chosen in the browser, then passes only its typed
reference to the run. An Artifact node can attach that reference or capture a
new file value. It can also import a portable bundle. The node's durable output
contains a `reference` or `references` field for later bindings and inspection.
Artifact nodes can validate that output with an authored output schema and can
append or merge it into v3 context. If validation or context application fails
after bytes were published, the failed run retains the operation ID and an
uncertainty record for explicit inspection; it does not replay the effect.
Version 1 and 2 definitions retain their original input and node contracts.

The `loops_artifact` tool and `artifact` command/action share the current
agent-and-chat-session authority. `capture` accepts canonical Base64 bytes and
a media type in `data`, with a stable `operationId`. Large JSON input can first
be staged with `loops_upload` and supplied as its completed upload reference.
The public request never supplies a filesystem path. A single file is limited
to 8 MiB. Each plugin-owned custody directory has a shared physical limit of
64 MiB and 256 files across owners; a different owner's files can consume that
capacity until authorized cleanup frees it. SQLite custody metadata has
separate per-owner quotas. A successful capture returns an opaque typed
reference containing its
SHA-256, byte length, media type, owner-scope digest, and run/node provenance.
The reference is an identifier, not a permission grant. Ordinary JSON with a
similar shape remains data; artifact inputs and Artifact nodes validate the
exact current owner-scoped publication before using it. A published reference
carried in ordinary JSON can still protect its bytes from cleanup while the
run or Memory record retains it.

`list` pages owner-scoped metadata with `nextCursor`. `metadata` reads one
reference and its current status. `page` reads at most 65,536 binary bytes as
canonical Base64; follow `nextOffset` until null and verify the total byte
length and SHA-256. The Run inspection panel performs that verification before
offering a download. It can also export one file as an embedded portable bundle
or export an external-reference manifest. `export` accepts explicit selections
with `embedded` or `external` mode. An external manifest contains no file
bytes; import requires the exact dependencies separately. Import verifies the
whole bundle and every dependency before publishing any new reference, binds
new IDs to the receiving owner and run, and never reads a path from the bundle.

Standalone captures that have never been linked to a run can be explicitly
`release-unused` with their exact artifact and operation IDs. The Run panel
offers this action for a file chosen but not used. A released file cannot be
downloaded, exported, or linked to a new run. It remains inspectable as
released until cleanup retires it. Linked, reserved, staged, uncertain, and
non-standalone artifacts cannot be released this way. There is no automatic
release of uncertain bytes or admissions.

`cleanup-preview` computes an exact plan under current protection for active,
parked, and uncertain runs; `cleanup-apply` requires that plan ID and policy.
Publication or cleanup interrupted between SQLite intent and file readback
remains explicit: use the corresponding inspect operation, then recover with a
fresh `recoveryId` only after current owner authorization and trusted custody
readback. The bridge reads the exact SQL inventory under the custody lease;
clients cannot supply recovery readback. Missing or corrupt noncandidate bytes,
staged data, and mixed uncertain states block cleanup recovery. Recovery
receipts distinguish observed absence from successful deletion.

Run evidence exports and definition templates contain typed references, not
their binary content. A portable file handoff therefore needs an embedded
artifact bundle or an external manifest plus verified dependency bytes. Keep
the reference and bundle in the same authorized owner scope when resuming a
run, or import the bundle to mint new owner-scoped references.
