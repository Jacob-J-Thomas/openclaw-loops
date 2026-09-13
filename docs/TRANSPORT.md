# Large data and operator budgets

OpenClaw 2026.9.3 validates each feature input/output against an independent transport envelope: 262,144 serialized UTF-8 bytes, 65,536 UTF-16 units in a string, 4,096 JSON values, 512 keys per object and nesting depth 32. A graph or run can exceed that envelope even when its individual output is small. Loops does not import the private validator; actual SDK adapter tests verify compatibility with it.

The UI uploads large input fields in bounded chunks and verifies the assembled digest before submitting the original operation. Agents can do the same with `loops_upload`: send a fresh upload ID, a Unicode character offset and a text chunk; mark the final chunk complete and supply the full UTF-8 JSON SHA-256. An identical chunk can be retried at its original offset. A changed or out-of-order chunk fails without replacing committed staging data. Completed uploads return `{$loopsUpload: "…"}`. Use that reference in the original tool's upload-capable field: `definition`, `changes`, or run/test `input` (also run's `text` shortcut). Original schema validation, expected revisions, admission identity, tool selection and actor authority still apply. Uploading never executes an operation and cannot add a new operation to a tool's permission surface.

Small operation responses preserve their normal shape. A large response returns `{kind:"loops-document", documentId, sha256, bytes, read:"loops_document", description}`. Retrieve it with `loops_document`, following `nextOffset` until null; concatenate `text`, verify the UTF-8 SHA-256 and parse the completed JSON. Pages contain at most 16,000 Unicode code points so escaped characters and surrogate pairs fit the host envelope. `loops_output` uses the same safe page sizing; its requested limit is an upper bound. No result content is clipped. The UI handles document retrieval automatically.

Agent tools also account for the pinned host's 8,000 UTF-16-unit direct tool display and 16,000-unit deferred `tool_call` report. Loops measures the public SDK's formatted `jsonResult`, including its text and structured details and the observed discovery report wrapper. Oversized results become document references; document/output pages fit both report envelopes. Therefore agent pages can be smaller than feature-API pages even when `limit` is omitted. Follow the actual `nextOffset` until null, not a predicted page size or definition revision; only then is retrieval complete. Transport compatibility tests compare the real registered SDK output and actual agent reports. A future host release or a deployment with different report limits needs fresh qualification.

Conversation commands also account for OpenClaw 2026.9.3's 8,000 UTF-16-unit display envelope. Loops measures the complete formatted reply, including JSON escaping and instructions. A result or detailed help response that exceeds this envelope returns a document reference even when it fits the larger feature SDK envelope. `/loops document {"documentId":"…","offset":0}` and `/loops output {"runId":"…","offset":0}` size each reply dynamically; always follow the returned `nextOffset`, which counts Unicode code points, until null. A requested `limit` is an upper bound, and command pages can be smaller than UI/tool pages. This does not change saved graph or output budgets. Document pages directly continue the original document; they do not produce recursive references to other pages. Detailed help is stored as a JSON string, so parse the reconstructed JSON to recover its text.

For lossless command inputs use `/loops <operation> --json-base64 <Base64 of UTF-8 JSON>`. For example, `/loops list --json-base64 e30=` encodes `{}`. Encode the entire argument object, using standard padded Base64 without line breaks. The decoded object goes through the same operation schema, staging budgets and authorization; encoding adds no authority. This avoids the current host's normalization of literal `\n` sequences before plugin dispatch, which can corrupt ordinary JSON containing escaped newlines. Malformed Base64/UTF-8/JSON is rejected without executing an operation. Keep the complete command argument string within the host's 4,096 UTF-16-unit input limit; encoded uploads still require small chunks (for example, 300 Unicode characters, checking the serialized command length). Calculate upload offsets from the decoded chunk's Unicode code points and the final digest from the original UTF-8 JSON, not its Base64 representation. The UI and agent tools send structured feature inputs and do not need this command encoding.

Documents are immutable snapshots, so concurrent edits or run progress cannot change a page halfway through retrieval. They survive Gateway restarts and remain readable only to the originating agent/session/generation while host authority is valid. Knowing a document ID does not grant access. Documents and request staging use private, atomically written files under `loops-poc/documents`; include that directory in profile backups. The existing plugin service worker owns document creation, reads and upload resolution alongside the engine. File waits delay Loops operations without blocking the Gateway event loop; host identity checks remain bound to the original invocation. A running service is required for file operations; small static command help remains available without it. The file format and wire references are unchanged across this move. Stop and restart the affected Gateway when upgrading. JSON serialization and worker message transfer still use CPU and memory; this does not promise that every large-payload cost is asynchronous.

These files are currently retained until explicit operator cleanup. Automated retention and large-scale storage optimization remain release work; these files are not a new infinite-storage guarantee.

## Configuration

Set these optional fields under `plugins.entries.loops-poc.config`, then restart the affected Gateway. Omitted fields use the values below. These are storage/execution settings, separate from the immutable host message envelope.

```json
{
  "maxConcurrentRuns": 1,
  "budgets": {
    "definitionBytes": 4194304,
    "inputBytes": 1048576,
    "promptBytes": 1048576,
    "defaultOutputBytes": 1048576,
    "defaultExecutions": 1000,
    "defaultRepeat": 3
  }
}
```

Definition/input/prompt byte settings validate new v2 work. The three `default…` settings initialize new UI definitions and Repeat nodes; explicit saved limits remain explicit. `loops_capabilities` reports effective budgets and concurrency to agents and the UI. Staged JSON is bounded at twice the larger definition/input budget and is validated against the specific original operation on use. Larger settings still require memory, disk and host runtime capacity; model context limits remain the runtime's responsibility.

Version 1 keeps its historical semantics and byte limits. Lowering a v2 admission budget never prevents loading already-saved definitions, revisions or run evidence; publishing/running new work must satisfy current policy. There is no automatic history deletion. Request staging and snapshots are inert JSON data, with no credentials or new execution authority added by this protocol.
# Expected operation failures

The wire result can be `{kind:"loops-error",operation,error:{code,message,phase,retryable,recovery,...}}`. This is a failed operation even when the Gateway successfully delivered the result. The shared UI client converts it to a typed exception; agents must report the failure and follow its recovery guidance. For example, `LOOPS_REVISION_CONFLICT` preserves a stale draft for merging, and `LOOPS_HISTORY_REMOVED` prevents a retired request from executing again.

Only explicitly classified plugin errors use this shape. Exception causes, stacks and unexpected host failures are not copied into the public result. This preserves useful expected messages through OpenClaw's session-action boundary, which deliberately masks arbitrary thrown plugin exceptions.

`upload` and `document` use that same failure envelope. The UI stops on a failed staging chunk before submitting the intended operation, and rejects failed page retrieval without returning partial content. Commands and agent tools receive the same code and recovery guidance. A failed response snapshot or page retrieval does not undo an already committed operation: inspect the current definition or run before retrying the original action.

Filesystem exhaustion, access failures and I/O failures use `LOOPS_STORAGE_FULL`, `LOOPS_STORAGE_ACCESS` and `LOOPS_STORAGE_IO`. A missing or foreign document uses the same `LOOPS_DOCUMENT_NOT_FOUND` message. Malformed records or failed integrity checks use `LOOPS_DOCUMENT_CORRUPT` and preserve the damaged file for diagnosis; an existing damaged snapshot is never silently overwritten. Upload offset conflicts, budget overflow and digest mismatch have separate `LOOPS_UPLOAD_CONFLICT`, `LOOPS_UPLOAD_TOO_LARGE` and `LOOPS_UPLOAD_INTEGRITY` codes. Invalid final JSON is a safe `LOOPS_INVALID_REQUEST`, without including its contents.

A failed write removes only that attempt's temporary file when the filesystem permits cleanup. If cleanup also fails, recovery guidance reports that fact. Previously committed staging and snapshots remain intact. If the final snapshot committed but writing the upload completion marker failed, retrying the identical chunk completes the original upload. This does not add automatic retry, retention or power-loss durability guarantees; a process or machine crash can still leave temporary files for explicit operator maintenance.

## Document readers

New managed result references include a `readerId`. Send that ID with every `document` page, including after reconnect or restart. Verify the concatenated UTF-8 digest and complete JSON before releasing that specific reader with `document_release`. A backend page may be shortened again to fit a command or tool reply; only the transmitted `nextOffset:null` marks the final page. The native client handles this protocol and releases its reader after complete retrieval. A failed retrieval retains the reader for inspection or continuation.

Readers are durable reservations, not extra access credentials. Every operation still checks the current authorized conversation. There is no automatic expiration. Independent consumers can use `document_acquire` to obtain separate reader IDs; releasing one does not release another. These reader operations use conversation read access, including for read-only viewers. They do not delete files or grant execution/authoring authority.

Reader acquisition and release commit metadata before acknowledgment. Reading pages with an already reserved reader does not need a new write, so committed data remains readable when storage is full. The native client preserves a successfully verified result if its subsequent release fails; it does not silently retry an uncertain release. Failed writes retain the reservation, while a lost response requires inspection to determine whether release committed. Remaining reservations appear in maintenance.

Older callers may omit `readerId`. Their multi-page lifetime cannot be established, so a managed document they read is marked as having an untracked compatibility reader and preserved conservatively. Existing legacy documents remain readable without rewriting them. Their missing provenance is never guessed. For new integrations, forward the returned reader ID and release it after use.

## Explicit transport file maintenance

Use **Transport file cleanup** in the native run inspector, `loops_maintenance`, or `/loops maintenance`. Supply `policy` with `olderThanDays`, `keepLatest`, or both. Unset age/count fields add no condition; at least one must be supplied. Explicit zero is valid. With both conditions, a file must be older than the age threshold and outside the protected newest group. The policy is applied only when requested; no cleanup timer or deletion default is added.

Preview returns eligible file IDs, kinds, logical byte sizes, protected counts, reader/upload reservations, and a `planId`. Apply that same policy and ID to delete the unchanged candidate set. A new eligible file, acquired reader, changed content or changed reference eligibility requires a new preview. Policy key order is immaterial. Cleanup uses the same authorized agent/operator write access as other authoring operations; there is no human-only gate.

New snapshots record their represented runs, immutable definition records and explicit nested document references. Retained runs protect their documents, including queued, running, parked and settling work. Retained definitions/revisions remain protected even when archived or marked deleted. Staged input is reserved while its operation executes; its resulting run/definition references commit before that reservation is released. An uncertain dispatch or failed provenance update leaves protected evidence instead of guessing that the input is unused.

Completed upload envelopes protect their result document while the envelope exists. A cleanup may remove the eligible envelope first; preview again to consider its newly unreferenced document. The same conservative rule applies when one document references another. Referenced documents and active readers cannot be removed by a cleanup plan.

Open uploads remain protected. To intentionally abandon one, inspect its entry and use `loops_transport_release` or `/loops transport_release` with `kind:"upload"`, its `uploadId`, and the inspected `sha256`. Changed content is rejected. The native pane supplies these fields. An abandoned upload refuses further chunks while its record remains; use a new upload ID for intentional new staging. Reclaiming staging never invokes a loop or frees an execution admission ID for reuse.

Maintenance also lists reserved readers. Release a reader there, or through `transport_release` with `kind:"reader"`, `documentId` and `readerId`, only when its consumer has finished or that reader is intentionally abandoned. This releases the reservation, not the document. A new preview determines whether other readers or durable references still protect it.

Legacy uploads have no recoverable owner metadata, and older temporary names cannot safely establish ownership. They remain outside conversation totals and are preserved. Damaged/unattributed files and unknown provenance are also preserved; cleanup does not repair, adopt or erase them. New temporary filenames include the owning scope, so abandoned temporary writes can be considered after the serialized writer has finished. Other conversations, SQLite records, configuration, original migration files and backups are outside file cleanup.

File removal is sequential and explicit. A stale preview is rejected before deletion. If storage or authorization fails after some removals, `LOOPS_MAINTENANCE_PARTIAL` reports how many files were removed; it does not claim rollback or complete success. Reopen/inspect and preview the remaining files before another requested cleanup. Reported bytes are removed logical file sizes, not a guarantee of secure erasure or physical block reclamation on a filesystem retaining snapshots/backups.

Verification separates real SQLite/service and registered UI/command/tool fixtures from installed journeys. The Linux dedicated-tmpfs check additionally measures actual available blocks after reclaiming two large managed documents and verifies restart/other-conversation preservation. Use the exact source/package/platform receipts for the candidate; these protocol changes do not claim host identity, account, durable-delivery or provider-lifetime guarantees beyond the public OpenClaw contracts.
