# Definition formats

New definitions use schemaVersion 2; existing v1 definitions/runs remain readable. See `examples/schema-v2.json`. V2 adds zero-input and nested JSON fields, safe nested bindings such as `{{nodes.summary.value.items.0.name}}`, typed equality, larger configurable budgets and Repeat counts bounded by total executions.

Inference supports optional `model`, `agentId`, `reasoning` and `advanced`. Advanced keys: `temperature`, `topP`, `topK`, `minP`, `typicalP`, `frequencyPenalty`, `presencePenalty`, `repetitionPenalty`, `seed`, `stop`, `maxTokens`. Omit to inherit; zero is a value. `loops_capabilities` and `loops_validate` report actual SDK support.

`loops_draft` preserves publication. `loops_publish` enables an immutable revision. `loops_restore` creates a new draft. Legacy `enabled:false` retains its disabling meaning. `loops_test` executes without publishing. Versions/history/inspect/output operations expose complete evidence. Archive/delete preserve recoverable history.

## Current binding and predicate behavior

An exact binding preserves its JSON type, including zero, false, empty text and null. Embedded bindings render non-string JSON as JSON text. Nested paths traverse existing own properties; missing values and unsafe prototype paths fail with `LOOPS_BINDING_UNAVAILABLE`. A declared optional input can be omitted at admission, but a node that consumes its missing value still fails. Missing is not converted to null, empty text or a false branch.

In version 2, `equals` and `not-equals` compare typed JSON values recursively: object key order is irrelevant and array order matters. `contains` searches array elements using that same equality; other values use case-sensitive displayed-text containment. Numeric comparisons require both resolved operands to be numbers. String fields remain templates: `"2"` is text, while `{{input.count}}` preserves a numeric input. An explicit `{"literalJson":"2"}` supplies a numeric constant. Version 1 retains displayed-value equality and finite numeric conversion.

Version 2 accepts either a string template or `{"literalJson":"<JSON source>"}` for Inference prompts, Condition operands, Wait messages, Human review proposals, Return values and Fail reasons, including Repeat body fields. JSON values can be numbers, booleans, null, strings, arrays or objects. For example, `{"literalJson":"{\"count\":0,\"ready\":false}"}` returns an object; `{"literalJson":"\"{{input.absent}}\""}` returns that literal text without interpolation. Numbers must be finite, nesting is limited to 100 levels, and prototype-related object keys are rejected. Inference renders a JSON value as one text prompt; its completion semantics are unchanged.

The editor's **Text or binding / JSON value** selector makes the distinction explicit. Switching existing text to JSON quotes it as a string rather than silently changing its type. Unfinished JSON source is retained in browser recovery and saved drafts. Validation, publication and unpublished testing reject consumed invalid JSON; an unused `truthy` right operand remains unused. Drafting does not replace an enabled publication. Tools and JSON commands use the same value form. Export/import, duplication and version restoration preserve it. Existing v1 nodes continue to accept only strings; **Use version 2 in this draft** is an explicit, undoable format change that does not modify pinned runs or automatically publish the draft.

`truthy` accepts only boolean true or the exact text `true` in both versions. Its right field is unused, so neither graph validation nor execution resolves bindings in it. Changing to a two-operand predicate makes that field subject to normal validation and missing-value rules.

Bindings may use only fields the selected producer can emit, after that producer is guaranteed on every path to the consumer. Optional host metadata can still be unavailable at execution. Input exposes `fields`; Wait has no output fields; Human review exposes `decision` after a response. Text Inference does not expose JSON `value`. Repeat exposes its last inference's fields and `succeeded`, `iterations` and `exhausted`; its body Condition can consume the preceding body Inference. Other nodes consume the parent Repeat output. Return and Fail terminate their path and cannot produce inputs for later nodes.

## Historical v1 contract

The text below records original POC behavior. The v2 and new lifecycle behavior above supersede it for new definitions.

# Definition format: schemaVersion 1

The portable contract is [schema-v1.json](../examples/schema-v1.json). The three files alongside it are editable examples, each with `revision: 0` so they can be saved as a new disabled definition. These are POC files, not a promise of compatibility with all EmbodySense graph formats.

A definition contains `schemaVersion`, stable `id`, readable unique `slug`, `name`, `description`, definition `revision`, `inputSchema`, `nodes`, `edges`, `layout`, `capabilities`, and `limits`. Unknown properties and unsupported node kinds are rejected. IDs are lowercase, start with a letter, and have at most 48 letters/digits/hyphens/underscores. Reserved prototype names are forbidden. Inputs are named text, finite number, or boolean fields; up to eight fields, with explicit `required` flags.

`save` uses the expected current revision (zero for new definitions), detects conflicts, and creates the next revision. It saves a disabled draft by default; `enabled:true` validates, saves and enables atomically. Imported UI definitions receive new IDs/slugs and revision zero. Grants/enabled state cannot be imported inside graph content. Run records pin the admitted definition.

Agent `loops_create` accepts `definition` fields except `schemaVersion`, `id` and `revision`, which the server assigns. Its optional `enabled` flag defaults to **true**; use `false` for a draft. `loops_edit` takes `id`, `expectedRevision`, a nonempty `changes` object and optional `enabled`. Omission preserves the saved loop's activation; true publishes the new revision and false saves a draft. Arrays/objects replace whole fields. Enabled saves validate topology and host access before committing anything. Draft saves return validation issues and remain non-runnable.

`loops_enable` takes `id`, current `revision` and `enabled:true/false`. Enabling validates and grants the graph's declared supported capabilities; no human-only step is required. The optional legacy `grants` checklist normally should be omitted. `loops_revoke` takes `id` and clears grants as well as activation, blocking later host actions in parked runs. Ordinary disabling retains grants for existing runs. `loops_library` includes drafts; `loops_read` returns the full saved record. `loops_delete` requires `id` and `expectedRevision`, rejects active/parked runs, and preserves terminal history. Invocation uses `loops_run` with `slug` and `input`; long-running work returns a real handle for `loops_status`. None of these operations approves an explicit Human review node.

Edges identify `id`, `source`, `target`, and source `port`. Ordinary nodes have one `next` edge; Condition has one `true` and one `false`; Human review has `approve` and `reject`; Return/Fail have none. Input is the unique entry with no incoming edge. Every node must be reachable, and all paths terminate. Cycles are invalid. A structured Repeat is the only repeat mechanism.

| Node kind | Properties beyond id/kind/label |
|---|---|
| `input` | None; fields are declared in inputSchema |
| `inference` | `prompt`, `output: "text"` or `"json"` |
| `action` | `capability: "model-info"` only |
| `condition` | `predicate: {left, op, right}` |
| `repeat` | `maxIterations` (1–5), `body` tuple of Inference then Condition |
| `wait` | `message`; manual checkpoint only |
| `review` | `proposal`; stored actual content for human decision |
| `return` | `value`, literal or binding; preserves type for an exact binding |
| `fail` | `reason` |

Predicates use `equals`, `not-equals`, `contains`, `less-than`, `greater-than`, or `truthy`. Equality compares displayed scalar/JSON values; numeric comparisons require finite numeric conversion; truthy accepts only boolean true or the exact string `true`. No JavaScript evaluation occurs.

Bindings use double braces. `{{input.text}}` reads a declared input. `{{nodes.summary.text}}` reads a previous model result. Available output fields are `text`, `value`, `provider`, `model`, `agentId`, and Repeat's `succeeded`, `iterations`, `exhausted`. The producer must be guaranteed to have executed on every path into the consuming node. An exact binding preserves JSON type; a binding embedded in other text is rendered as text. Missing output fields fail explicitly at runtime. No arbitrary property traversal, expression evaluation or prototype access is allowed.

Within Repeat, `{{repeat.index}}` is one-based. Its Condition may read the immediately preceding body inference. The Repeat output contains the last inference result and its success/exhaustion/iteration counts. Body node IDs must be globally unique. There are no nested loops, arbitrary cycles, parallel branches, joins, or child runs.

`output: "json"` requires the actual completion to parse as a flat object with at most 16 scalar fields. Invalid data fails before downstream dispatch. The original `text` and validated `value` are both inspectable. Model attribution is supplied by OpenClaw and retained with each inference output.

Limits are server enforced; UI validation helps authoring but cannot grant authority. `layout` stores finite x/y coordinates in the range ±10,000. Layout does not affect execution. See [capabilities](CAPABILITIES.md) for execution, size, retention and concurrency bounds.

## Internal node contracts

The current sequential palette is defined by `src/node-contracts.ts`. Each kind supplies a strict schema, required capabilities, input binding references, output fields, exit ports, execution handler and editor metadata/defaults. The engine retains control of authorization, transaction checkpoints, cancellation, budgets and human-review decisions. Registry handlers receive those bounded operations rather than the host API or storage. This is an internal structure for the existing palette; it does not introduce an external node-loading API or the later script/agent/control-flow families. Alpha.13 preserves the complete definition wire schema and version 1/2 execution semantics.
