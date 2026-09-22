# Portable loop templates

A portable template package is a versioned, JSON-only envelope for editable loop definitions. It carries no saved-loop activation, grants, runs, credentials, caller/session identity or runtime configuration. A package can be previewed safely: preview validates its canonical SHA-256 digest, every included template's exact content pin, declared dependency pins, and named environment bindings. Preview neither writes definitions nor dispatches a loop.

## Envelope

`kind` is `loops-template-package` and `formatVersion` is `1`. Its `digest` is the SHA-256 of the canonical JSON object containing `kind`, `formatVersion`, `templates` and `bindings`: object keys are lexically sorted and JSON has no insignificant whitespace. Every template has a stable `templateId`, JSON `content`, that content's `contentDigest`, and dependency entries naming an included `templateId` plus its exact digest. Duplicate content, IDs, stale pins and dependency cycles are invalid.

Bindings are named and typed (`string`, `number`, `boolean` or `json`). Each one lists exact JSON Pointer locations and those locations must contain only `{ "$loopsBinding": "name" }` markers. Import callers supply every declared binding and no undeclared one. This makes the target explicit and prevents an environment value from silently changing identity, authority or another field. A package cannot contain implicit absolute workspace metadata; an integration may only map environment-dependent values through these declarations.

The codec preserves definition JSON exactly while it parses and resolves a package. It does not claim that an unfamiliar future definition schema is valid. The current engine integration validates the resolved definition using the installed graph contract before a requested import is applied.

## Import flow

1. Export returns the package and its digest from an authorized saved definition.
2. Preview resolves declared environment values, validates every pin and reports the prospective definitions without writing or enabling them.
3. Import applies only the exact inspected digest through the current actor's normal draft/publish authority. It rechecks target revisions and refuses existing-ID collisions or partial updates.

Imports create distinct local draft identities by default. A requested enabled import uses the normal create/publish authority; it does not transfer a source grant or add a human-only gate. An authored Human review node retains its ordinary decision behavior after import.
