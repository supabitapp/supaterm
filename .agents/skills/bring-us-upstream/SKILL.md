---
name: bring-us-upstream
description: Review t3codes upstream changes, explain what to port or skip, and get approval before implementation.
---

# Bring upstream changes

Use when asked to sync or port code from upstream. Here are the procedure

## Review first

- Identify the baseline and upstream ref or range.
- Inspect the actual PRs, commits, and relevant code, tests, contracts, migrations, and docs.
- Check affected server, client, provider, persistence, and connection surfaces.
- Classify every change:
  - **Bring:** compatible and in scope,
  - **Adapt**: if upstream has the same features implemented or bug fixes but different from us, should we adapt, how?
  - **Skip:** conflicting, redundant, unsupported, risky, or out of scope.
  - **Decide:** requires a product, security, migration, or compatibility choice.
- Use source evidence. Do not rely on commit titles alone.

## Present and wait

Show the user:

- the baseline and upstream range;
- proposed ports, behavior, affected surfaces, dependencies, and tests;
- skipped items with reasons;
- open decisions and non-goals;
- the exact implementation boundary.

## Implement after approval

Implement only approved items. If the scope expands, present a revised proposal first. Preserve local behavior, add focused tests, update docs when needed, and run targeted checks. Report what changed, what was skipped, validation, and remaining manual checks.

Create a final PR including the whole port.

## Notes

Use subagents to read and explore, but for editting, only use subagents when the changes can be clearly separated and work in parallel.
