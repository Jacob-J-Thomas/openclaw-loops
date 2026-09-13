# Recovery after interruption

Inspect the run before choosing recovery. A retained result describes the
plugin's committed observations; an interrupted host call may have completed
without its result reaching Loops. Opening the database never replays it.

Manual Wait and Human review remain parked across restart. Use Continue for a
Wait and an authenticated human decision for an authored review. These actions
continue the same run. Agents can author, activate, invoke and recover loops;
they cannot supply the human decision at an explicitly authored review node.

Failed, interrupted and cancelled runs support three explicit recovery modes:

| Mode | New attempt starts at | Retained context |
|---|---|---|
| `checkpoint` | The committed top-level cursor | Earlier outputs and decisions; unavailable for an uncertain or unfinished attempt. |
| `retry-node` | The current top-level node | Earlier outputs and decisions. The current node executes again, including any effects whose outcome was uncertain. |
| `restart` | The Input node | The pinned definition, input and execution settings. Outputs and prior human decisions are cleared. Authored reviews require new decisions. |

Recovery creates a new run with `parentRunId`. The original run, its attempts,
decisions and outputs remain inspectable. A later recovery points to its
immediate predecessor, preserving the chain. Fresh recovery requests use fresh
request IDs. Repeating the same request ID and recovery parameters returns the
existing child; changing the mode or parent under that ID is a conflict.

Repeat is a top-level node containing inference/condition iterations. A fully
committed Repeat is not rerun by checkpoint recovery. An interruption inside
Repeat requires explicit recovery; `retry-node` starts that Repeat again and
can repeat already completed inference iterations. The retained parent trace
and outputs show which child attempts had committed before interruption.

Cancelled queued work has not dispatched a node. Queued work interrupted by a
process restart requires an authorized checkpoint recovery request. A run whose
host call is still physically settling cannot be recovered in that process.
After restart, the former promise is no longer owned by the new process and its
external outcome remains uncertain. Do not interpret disappearance of the old
cleanup flag as proof that the provider stopped.

Recovery rechecks current host permissions and current loop grants. It retains
the admitted definition and execution settings rather than selecting a newly
edited publication or another conversation model. A continuation retains an
already committed human decision; a full restart clears it while preserving the
original decision in the parent run. Budgets apply afresh to the new admission.

On authorized access, older saved runs pending Human review have inherited
decision metadata removed if no review node in that run has a committed decision
output. The repair commits before inspection or an idempotent retry returns.
Valid decisions from earlier review nodes and terminal historical records remain
unchanged. A storage failure reports an error instead of claiming the repair
succeeded; no node or human decision executes during this repair.

## Verification boundaries

The process-crash tests send SIGKILL at persisted admission, inference, Repeat,
Wait, approval/rejection, queued and cancellation boundaries. Their append-only
synthetic effect log distinguishes committed output from uncertain work. A
second-crash recovery chain checks pinned settings, parent evidence, current
authority, duplicate requests and another database reopen. These are real
process/storage tests with synthetic host completions, not provider receipts.

Registered public SDK tests exercise UI, command and tool recovery operations,
including a fresh review after restart and preserved approval after retry-node.
Installed browser, conversation and real-agent receipts are recorded separately
on the delivery Bolt. Package and platform results qualify their exact artifact.

OpenClaw's durable host-call ownership, retained request authority, cancellation
settlement and asynchronous delivery contracts remain separate dependencies
under SDK02/04/06 in [the upstream register](UPSTREAM_REQUIREMENTS.md). These tests
do not prove unavailable host behavior or permission to bypass it. For matched
application/database rollback, see [deployment](DEPLOYMENT.md).
