---
name: bring-us-upstream
description: Review and port t3code upstream changes, defaulting to compatible work while preserving Supaterm's deliberate fork differences.
---

# Bring upstream changes

Use when asked to sync or port code from upstream.

## Review first

Before editing:

- Read repository instructions and identify the baseline and upstream ref or range.
- Create a unique temporary CSV outside the worktree with columns `upstream_ref,change,decision,notes,status`.
- Populate the full inventory before detailed review or implementation, with `status` set to `Pending` and decisions initially blank. Cover every commit in the range.
- Read each merged PR's description and actual diff, and inspect commits outside PRs in the range.
- When upstream reverts or follows up on a change an earlier port brought, compare upstream's before and after with what that port left in our tree, including fork-only consumers, not with upstream's patch. Earlier ports adapt code, so a revert can apply cleanly in one file and conflict in another.
- Check relevant code, tests, contracts, migrations, and affected server, client, provider, persistence, and connection surfaces.
- Default to bringing compatible upstream work, including new capabilities and architectural changes. Size, implementation effort, new dependencies, and routine branding or integration work belong in the port plan.
- Fill each row's `decision` and `notes` from the review, splitting a commit into rows when its changes need different decisions:
  - **Bring:** compatible with Supaterm's goals, including changes that need adaptation, migrations, or additional tests.
  - **Skip:** already present, tied to an intentionally absent subsystem, outside the requested range, or contrary to a deliberate fork decision. Name the evidence for the exclusion.
  - **Decide:** a concrete conflict or consequential choice that cannot be resolved from the user's instructions and existing fork behavior. State the alternatives, consequences, and recommendation.
- Highlight compatibility consequences inside the proposed port. Reserve separate decisions for unresolved choices, such as whether existing users must re-pair or which conflicting local behavior to retain.
- Use source evidence. Do not rely on commit titles alone.

Use the CSV as the workpad throughout the task. Fill every decision before presenting scope, and update notes with evidence, adaptations, blockers, and validation as work progresses. Do not commit the CSV.

Review before implementation. When the user has not already authorized the scope, present it and get approval before editing. Existing approval persists; "bring all" approves the proposed ports and decision bundles unless the user gives a narrower boundary.

## Present and wait

Show the user:

- the baseline and upstream range;
- proposed ports, behavior, affected surfaces, dependencies, and tests;
- skipped items with reasons;
- open decisions and non-goals;
- the exact implementation boundary.

Include the behavior summary and grouped skip reasons directly in the scope message, and provide the CSV path for the full inventory.

If approval is still needed, ask whether to approve the proposed scope or revise it, then wait. Do not turn routine integration work into a menu of optional upstream features or ask again for approved work.

## Implement after approval

Implement the approved scope and resolve routine adaptation choices autonomously. Seek another decision only for a material expansion or a newly discovered conflict that the existing authorization does not settle. Preserve deliberate fork behavior, add focused tests, update docs when needed, and run targeted checks.

Update each CSV row as work completes. Mark a `Bring` row `Done` only after its complete behavior, including removals, is verified in the integrated tree; compiling is not enough. Never swap in a nearby identifier to make a partial apply compile. Split excluded parts into `Skip` rows with evidence and leave unfinished parts `Pending`. Mark `Skip` rows `Done` once their reasons are supported by evidence. Keep `Decide` rows `Pending` until resolved to `Bring` or `Skip`.

Trace architectural changes through fork-only consumers and check their behavior and performance assumptions. Focus cleanup on adaptation code and avoid unrelated rewrites of upstream-equivalent code.

Before opening a PR or reporting completion, reconcile every CSV row with the approved scope and final integrated tree, including required configuration and preserved fork behavior. Recheck "already present" skips affected by other ports or merges, returning invalidated rows to `Pending`. Resolve or explicitly report remaining pending rows.

Then check for removals that did not land:

```bash
node .agents/skills/bring-us-upstream/scripts/find-unlanded-removals.ts \
  --upstream <t3code checkout> --base <base> --end <end>
```

It lists lines that any commit in the range removed, that upstream's end state no longer has, and that our copy of the same file still has, each under the commit that removed it. Scanning per commit catches changes added and reverted inside the range. Map every candidate to its CSV row: a `Skip` whose evidence covers it, `Pending` until the removal lands, or a note showing it is not a missed removal.

Report what changed, what was skipped, validation, and remaining manual checks. Commit, push, and create a PR only when authorized. State the exact upstream base and end SHAs in the PR body so the next port starts there. Post the final CSV as a collapsed PR comment, split across comments if needed, so later audits can see each row's decision.
