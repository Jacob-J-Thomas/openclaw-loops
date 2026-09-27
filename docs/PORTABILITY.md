# Portable loop templates

A portable template package is a versioned, JSON-only envelope for editable loop definitions. It carries no saved-loop activation, grants, runs, credentials, caller/session identity or runtime configuration. A package can be previewed safely: preview validates its canonical SHA-256 digest, every included template's exact content pin, declared dependency pins, and named environment bindings. Preview neither writes definitions nor dispatches a loop.

## Envelope

`kind` is `loops-template-package` and `formatVersion` is `1`. Its `digest` is the SHA-256 of the canonical JSON object containing `kind`, `formatVersion`, `templates` and `bindings`: object keys are lexically sorted and JSON has no insignificant whitespace. Every template has a stable `templateId`, JSON `content`, that content's `contentDigest`, and dependency entries naming an included `templateId` plus its exact digest. Duplicate content, IDs, stale pins and dependency cycles are invalid.

Bindings are named and typed (`string`, `number`, `boolean` or `json`). Each one lists exact JSON Pointer locations and those locations must contain only `{ "$loopsBinding": "name" }` markers. Import callers supply every declared binding and no undeclared one. This makes the target explicit and prevents an environment value from silently changing identity, authority or another field. A package cannot contain implicit absolute workspace metadata; an integration may only map environment-dependent values through these declarations.

The codec preserves definition JSON exactly while it parses and resolves a package. It does not claim that an unfamiliar future definition schema is valid. The current engine integration validates the resolved definition using the installed graph contract before a requested import is applied.

## Import flow

1. Export returns the package and its digest from an authorized saved definition.
2. Preview resolves declared environment values, validates every pin and reports the prospective definitions without writing or enabling them. It returns a `resolvedDigest` that binds those resolved definitions and the supplied typed environment values, plus a `libraryDigest` that pins the current local ID and current-or-published slug collision state.
3. Import applies only the exact inspected package, resolved, and library digests through the current actor's normal draft/publish authority. It rechecks all three before its one state transaction, so a changed binding value, a changed publication target, an existing-ID collision, or any other stale target leaves the library unchanged.

Imports create distinct local draft identities by default. A requested enabled import uses the normal create/publish authority; it does not transfer a source grant or add a human-only gate. An authored Human review node retains its ordinary decision behavior after import.

## Inspected targets and retained provenance

Preview reports each final local ID and collision-safe slug, the resolved definition, dependency pins, and ordinary graph diagnostics. A graph-invalid definition may still be imported as a disabled draft; enabling it continues to require the normal graph and capability checks. Generated slugs reserve room for the import suffix within the 48-character identifier contract. Changing a typed environment value or the effective published slug state invalidates the preview confirmation.

An accepted import retains the validated source package and a small, revision-bound mapping for each imported definition: package and template pins, selected binding locations, dependency pins, resolved target digest, and its immutable local revision. The source package is stored once on the first imported record under the configured package transport byte limit; sibling records refer to it. Current delete/archive/recover operations retain records as tombstones, so a sibling can still re-export after the source record is deleted. Reopening validates every reference and package pin. This adds an optional field to existing loop-record JSON; it does not change the SQLite schema version or copy grants, sessions, credentials, or runtime configuration.

With no new binding declarations, exporting an unchanged imported revision returns its original package, including its dependencies and binding markers. After editing the local definition, export reapplies the retained binding locations to the edited single template; dependencies from the former package are not asserted for changed content. If an edited revision removes a retained binding location, export fails explicitly until the caller supplies new declarations. Explicit export bindings always describe the current definition.
