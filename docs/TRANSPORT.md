# Large data and operator budgets

OpenClaw 2026.9.3 validates each feature input/output against an independent transport envelope: 262,144 serialized UTF-8 bytes, 65,536 UTF-16 units in a string, 4,096 JSON values, 512 keys per object and nesting depth 32. A graph or run can exceed that envelope even when its individual output is small. Loops does not import the private validator; actual SDK adapter tests verify compatibility with it.

The UI uploads large input fields in bounded chunks and verifies the assembled digest before submitting the original operation. Agents can do the same with `loops_upload`: send a fresh upload ID, a Unicode character offset and a text chunk; mark the final chunk complete and supply the full UTF-8 JSON SHA-256. An identical chunk can be retried at its original offset. A changed or out-of-order chunk fails without replacing committed staging data. Completed uploads return `{$loopsUpload: "…"}`. Use that reference in the original tool's upload-capable field: `definition`, `changes`, or run/test `input` (also run's `text` shortcut). Original schema validation, expected revisions, admission identity, tool selection and actor authority still apply. Uploading never executes an operation and cannot add a new operation to a tool's permission surface.

Small operation responses preserve their normal shape. A large response returns `{kind:"loops-document", documentId, sha256, bytes, read:"loops_document", description}`. Retrieve it with `loops_document`, following `nextOffset` until null; concatenate `text`, verify the UTF-8 SHA-256 and parse the completed JSON. Pages contain at most 16,000 Unicode code points so escaped characters and surrogate pairs fit the host envelope. `loops_output` uses the same safe page sizing; its requested limit is an upper bound. No result content is clipped. The UI handles document retrieval automatically.

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
