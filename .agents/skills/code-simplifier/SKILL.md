---
name: code-simplifier
description: 'Review and simplify recently modified code while preserving exact behavior. Use when cleaning up a PR, reducing complexity after implementation, improving clarity/consistency, or refining code in this repo without changing functionality. Especially relevant for Supaterm changes touching TCA reducers, TerminalHostState, Sharing persistence, server/web pane-session state, or zmx integration.'
---
# Code Simplifier

Simplify code that was recently modified in the current session or PR. Preserve exact behavior, public API intent, and product semantics.

This skill is for cleanup passes, not feature work.

## Primary Goal

Make the code easier to read, reason about, and maintain without changing what it does.

Prioritize:

- clearer control flow
- fewer incidental abstractions
- explicit state transitions
- smaller blast radius
- consistency with existing repo patterns

Do not optimize for fewer lines.

## Repo-Specific Rules

1. Follow the existing Supaterm architecture:
   - TCA reducers own feature state and side effects
   - `TerminalHostState` owns Ghostty runtime/view lifecycle
   - Sharing keys are the persistence boundary
   - server/web shared protocol types stay aligned with native semantics
2. Prefer preserving the current ownership boundaries over inventing new ones during cleanup.
3. For reducers, keep behavior explicit and testable. If logic changes materially, add or update tests.
4. For persistence or conflict-resolution code, prefer correctness and traceability over terseness.
5. For Swift 6 code, respect the project defaults:
   - `SWIFT_DEFAULT_ACTOR_ISOLATION=MainActor`
   - `SWIFT_APPROACHABLE_CONCURRENCY=YES`
6. For this repo, simplification should not weaken:
   - pane/session identity
   - `zmx` lifecycle semantics
   - tombstone/conflict-resolution guarantees
   - native/server shared catalog compatibility

## What To Simplify

Focus on recently changed code first:

- duplicated logic
- confusing branching or nesting
- state mutation spread across too many places
- helpers that obscure simple behavior
- inconsistent naming
- unnecessary comments
- ad hoc lifecycle handling that should use the existing client/reducer/runtime boundary

## What Not To Do

Do not:

- change user-visible behavior
- broaden scope beyond touched files unless needed for consistency
- replace explicit code with clever compact code
- collapse distinct lifecycle states into one path
- remove tests that explain important behavior
- rewrite working code just for style

Avoid nested ternaries and dense one-liners. Prefer `if`/`guard`/`switch`.

## Recommended Workflow

1. Identify the recently touched files.
2. Read only enough surrounding code to understand the current ownership boundary.
3. Look for the smallest simplification that improves clarity without semantic drift.
4. Apply the cleanup.
5. Run focused validation for the touched area.

## Validation

Use the narrowest relevant checks:

- Swift feature/reducer/native changes:
  - targeted `xcodebuild test`
- server/web/shared TypeScript changes:
  - `cd packages/server && bun test && bun run typecheck && bun run lint`
- mixed native/server persistence or protocol changes:
  - run both

Prefer the repo’s focused tests over a full-suite pass when doing a cleanup-only PR refinement.

## PR Cleanup Checklist

Before finishing, check:

- Is the final code easier to scan than before?
- Is each mutation path still obvious?
- Are native/server semantics still aligned?
- Did the cleanup preserve all persistence and session lifecycle guarantees?
- Are tests still proving the important behavior?
