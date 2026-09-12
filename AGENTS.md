# OpenClaw Loops delivery

Read [docs/AIDLC.md](docs/AIDLC.md), the current issue contract, [delivery plan](docs/DELIVERY_PLAN.md) and [status](docs/DELIVERY_STATUS.md) before implementation. Current owner instructions override historical plans and issue prose.

- Keep this repository an external OpenClaw plugin. Use supported public host APIs; keep host code/patches, provider clients, personal profiles and EmbodySense work out of it.
- Refresh live `main`, the worktree, native issue hierarchy, candidate head/base, checks and review budget. Preserve existing work and PR ownership.
- Use one scoped Bolt issue per PR, one active candidate per Bolt, `codex/` branches for new work, non-draft PRs and `main` as every PR's base. No direct implementation pushes to main.
- The owner has standing authority for scoped issue maintenance, pushes, ready PRs, bounded `@codex review`, and verified merges to main. Do not ask again for those actions.
- Cap Codex review requests at three per Bolt/candidate across revisions. Mirror request IDs on the Bolt, read the feedback, fix or justify every finding, and retain exact head/base evidence. Neither a bare comment nor green CI is independent review approval.
- Merge only after current applicable checks pass, review findings are resolved and every final delta is accounted for under docs/AIDLC.md. At the three-run cap, verify and record only the bounded repairs explicitly prescribed by the final review; do not request a fourth run or claim it reviewed the repaired SHA. Use `node scripts/merge-aidlc.mjs <PR> <reviewed head SHA> <reviewed main SHA>` for its fresh metadata/check validation and expected-head merge; a green workflow snapshot is insufficient. Verify main and issue closure afterward; accept parents separately.
- After implementation PRs have landed and none remain open, execute the adversarial whole-plugin QA inventory. Track each observed root cause, fix admitted findings through the same process, and repeat affected and combined acceptance.
- Keep genuine missing OpenClaw API contracts visible. Do not fabricate integration success from fakes, bypass host policy, lower product requirements, or hide a failed test behind a new restriction.
- Preserve full agent loop control. Human authority is required only for explicitly authored Human review decisions. Honor the 16 GB local memory budget with one inference worker and separate dev profiles.

Use `npm run check` and `node scripts/verify-package.mjs`; the declared CI matrix is macOS/Linux with Node 24.16.0/26.1.0. Add real browser/command/tool, storage fault or runtime checks appropriate to the issue. Keep private evidence under ignored `evidence/` and publish only sanitized receipts.
