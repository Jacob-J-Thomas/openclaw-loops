# Post-1.0 feature delivery exception

The owner's September 22, 2026 instruction permits ready, scoped post-1.0 Bolt
PRs to merge into `codex/post-1.0-local-expansion` while feasible expansion work
is integrated. It does not authorize a final feature-to-`main` merge. Open that
final PR only after all feasible post-1.0 work has been reconciled with current
`main`; it remains a separately scoped integration Bolt and is outside this
admission.

Every feature-targeted PR must still be non-draft, identify one native leaf Bolt,
pass current checks, receive independent review, and use the normal expected-head
merge command with its exact feature-base SHA. Because GitHub closing references
are not authoritative for a non-default branch, its body must contain exactly:

```text
<!-- loops-bolt:<Bolt number> -->
```

The AIDLC guard pages through all open PR ownership metadata and rejects duplicate
or conflicting marker/GitHub ownership. If GitHub exposes a closing reference for
the PR, it must name that same local Bolt. A normal PR to `main` still requires
exactly one GitHub-recognized closing reference; the marker is optional there and
must match that reference when present.

Feature merges may close their proven marked Bolt under this one-time owner
instruction. They do not close UOWs, Phases, Campaigns, or the final integration
Bolt. The three-round review maximum applies across all review forms and revisions.
At the cap, only the final review's explicitly prescribed bounded repair may be
made with fresh regression coverage and checks; no fourth review is requested and
no reviewer is claimed to have reviewed that repaired SHA.
