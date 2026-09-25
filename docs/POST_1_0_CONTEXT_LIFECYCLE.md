# Context lifecycle operations

Version 3 loops can add a **Context lifecycle** node. Each operation carries its
own JSON Pointer selection, write target, reason and optional retained source;
the editor validates the authored configuration before a loop is saved.

- **retrieve** and **reset** read an explicit initial snapshot or retained
  owner-scoped source. They never search a model, session history, or memory.
- **inject** writes an authored JSON value or an explicit retained source.
- **summarize** sends only the selected paths and authored instructions through
  the existing isolated completion adapter. It leaves the selected values live.
- **compact** does the same completion, then replaces the named target and
  removes only the selected mutable paths.

Before every lifecycle mutation, Loops creates an immutable DocumentStore
snapshot linked to the run. The context record contains its document ID,
digest, byte count, selected and removed paths, reason, source and target
versions, and the exact model receipt where a completion was used. Document
creation occurs before a destructive change. If document creation, completion,
abort handling, budget validation, or the transactional run checkpoint fails,
the context mutation is not published. A document written before such a failure
may remain as recoverable orphan evidence.

Run inspection exposes every retained source. Source IDs are exact 64-character
lowercase hexadecimal document digests supplied explicitly to later retrieve
or reset nodes and scoped by DocumentStore ownership, so a
different conversation cannot read them. An invalid digest remains visible in
the local editor until repaired, but fails schema validation: it cannot be
saved as a server revision, published, or sent to draft Test. Choosing Authored value after a
retained source, or switching a summary to Inject with no source, stores an
explicit JSON null rather than only displaying one. `/input` is immutable;
invalid JSON Pointers, prototype-sensitive keys, unavailable sources,
overlapping compact targets, and output/context budget overflow fail closed.
