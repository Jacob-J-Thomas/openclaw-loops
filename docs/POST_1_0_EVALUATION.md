# Deterministic evaluation and evidence gates

Schema version 3 adds two local, deterministic nodes. They run without a model call, provider client, network schema resolver, custom validator code, or a new host permission.

`evaluate` resolves its `value` using ordinary typed bindings and evaluates it in one bounded worker. An evaluator is either `json-schema-2020` with a JSON Schema 2020-12 `schema`, or `predicate` with a versioned comparison operation. The worker rejects remote and dynamic references, invalid schemas, malformed configuration, excessive nesting, and inputs/configuration/results outside its byte, error-count, time, heap, and stack limits. Failure to evaluate is a failed run with a structured error; a valid evaluation that does not match produces committed evidence with `passed: false` and structured validation errors.

An Evaluate output is durable evidence:

```json
{
  "kind": "loops-evaluation",
  "passed": true,
  "evaluatorVersion": "2020-12",
  "evaluatorDigest": "…",
  "inputDigest": "…",
  "evidenceDigest": "…",
  "evaluatorNodeId": "evaluate"
}
```

Digests use canonical JSON, so object-key order does not change evidence. `evaluatorNodeId` is written only when the engine commits the Evaluate output; it is part of `evidenceDigest`. The run inspector displays this output as committed evaluation evidence and it is included in ordinary `loops_inspect` and `loops_output` retrieval.

`gate` names the Evaluate node through `evaluationId`. Graph validation requires that named node to be an Evaluate node that dominates the gate, so each path into the gate has committed its current-run evidence. At runtime a gate checks the stored evidence kind, node identity, pass value, and digest before choosing its `true` or `false` edge. A literal boolean or an output from a different node cannot route an evidence gate.

The editor exposes evaluator type, version, JSON Schema/predicate configuration, an exact value binding or JSON literal, a committed Evaluate selector, and the two gate branches. Adding either node upgrades only that draft to v3. Existing v1/v2 definitions and pinned runs retain their formats and behavior.
