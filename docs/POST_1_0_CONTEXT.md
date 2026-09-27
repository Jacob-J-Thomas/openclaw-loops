# Post-1.0 shared context contract

Version 3 definitions may opt a node into shared context. Earlier definitions
remain unchanged. A v3 run starts with context version `0` and value
`{"input": <validated input>}`. `/input` is immutable.

Each opt-in node declares:

```json
{
  "context": {
    "version": 1,
    "projection": {"mode": "consume", "paths": ["/input/brief"]},
    "patch": {"mode": "replace", "target": "/draft", "source": {"kind": "output", "path": "/text"}}
  }
}
```

`omit` exposes no `context` binding. `consume` deep-clones only the declared
paths, which bind as `{{context.input.brief}}`. Dotted bindings accept only
safe identifier/array segments. Use JSON-string brackets for any RFC 6901
object key that contains punctuation, spaces, or dots: `{{context["a/b"]}}`,
`{{context["dot.key"]}}`. Paths remain RFC 6901 JSON Pointers, so `~0`
represents `~` and `~1` represents `/`; prototype-sensitive keys are
rejected. A projection of an individual array element is represented as a
numeric-keyed object (for example `/input/items/2` becomes
`context.input.items.2`), so it does not expose adjacent elements or create a
sparse array. Literal patch sources use the existing `NodeValue` form.

Patches apply only after the node result has passed its output limit and at
the same durable checkpoint: `replace` creates/replaces a target, `append`
requires an existing array, and `merge` recursively combines plain objects
without overwriting unequal scalar/array values. Every committed patch records
node ID, base/result versions, mode, target, source, byte length and SHA-256
of its resolved value in the run journal. Failed/cancelled work does not add a
journal entry. Context plus outputs is bounded by the configured input and
output evidence budgets. Inspect a run to retrieve the complete snapshot and
journal.
