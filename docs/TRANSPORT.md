# Large data and operator budgets

OpenClaw 2026.9.3 validates each feature input/output against an independent transport envelope: 262,144 serialized UTF-8 bytes, 65,536 UTF-16 units in a string, 4,096 JSON values, 512 keys per object and nesting depth 32. A graph or run can exceed that envelope even when its individual output is small. Loops does not import the private validator; actual SDK adapter tests verify compatibility with it.

The UI uploads large input fields in bounded chunks and verifies the assembled digest before submitting the original operation. Agents can do the same with `loops_upload`: send a fresh upload ID, a Unicode character offset and a text chunk; mark the final chunk complete and supply the full UTF-8 JSON SHA-256. An identical chunk can be retried at its original offset. A changed or out-of-order chunk fails without replacing committed staging data. Completed uploads return `{$loopsUpload: "…"}`. Use that reference in the original tool's upload-capable field: `definition`, `changes`, or run/test `input` (also run's `text` shortcut). Original schema validation, expected revisions, admission identity, tool selection and actor authority still apply. Uploading never executes an operation and cannot add a new operation to a tool's permission surface.

Small operation responses preserve their normal shape. A large response returns `{kind:"loops-document", documentId, sha256, bytes, read:"loops_document", description}`. Retrieve it with `loops_document`, following `nextOffset` until null; concatenate `text`, verify the UTF-8 SHA-256 and parse the completed JSON. Pages contain at most 16,000 Unicode code points so escaped characters and surrogate pairs fit the host envelope. `loops_output` uses the same safe page sizing; its requested limit is an upper bound. No result content is clipped. The UI handles document retrieval automatically.

Documents are immutable snapshots, so concurrent edits or run progress cannot change a page halfway through retrieval. They survive Gateway restarts and remain readable only to the originating agent/session/generation while host authority is valid. Knowing a document ID does not grant access. Documents and request staging use private, atomically written files under `loops-poc/documents`; include that directory in profile backups. They are currently retained until explicit operator cleanup. Automated retention and large-scale storage optimization remain release work; these files are not a new infinite-storage guarantee.

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
