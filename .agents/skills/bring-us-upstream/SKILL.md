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
- what features are being put under Labs/Feature Flags under upstream
- the exact implementation boundary.

## Implement after approval

Implement only approved items. If the scope expands, present a revised proposal first. Preserve local behavior, add focused tests, update docs when needed, and run targeted checks. Report what changed, what was skipped, validation, and remaining manual checks.

Before declaring a port complete, byte-compare every agent-facing prompt, tool description, MCP schema, and returned instruction against the pinned upstream commit, allowing only required renames and explicitly approved fork exceptions.

## Test every ported feature before the PR

Green tests do not prove a port. Before you open or update the PR, run the integrated branch on desktop and on mobile and exercise every user-visible feature and fix the port brings, plus the fork-only features its conflicts touched:

- **Desktop:** run `vp run dev:desktop` and drive the Electron app (with `agent-desktop` where available). Cover startup, the shell's own surfaces (preview browser, menus, updates, keep awake, drag and drop), and each ported web feature. Use [test-supaterm-app](../test-supaterm-app/SKILL.md) for the web client in the Browser panel and free `Replay (dev)` turns.
- **Mobile:** follow [test-supaterm-mobile](../test-supaterm-mobile/SKILL.md) on both an iOS simulator and an Android emulator. Run `vp run mobile:install` first, because a port usually changes the native fingerprint. Cover pairing, a turn with an approval, the outbox offline and back online, voice, the terminal, and each ported mobile feature.

Keep a checklist with one line per ported feature and its result on each surface. Capture screenshots for the PR. A feature you could not exercise stays on the checklist as unverified, with the reason, and goes in the PR body. Fix regressions you find before opening the PR.

When the developer asks for a PR, create one including the whole port.

## Notes

Use subagents to read and explore, but for editting, only use subagents when the changes can be clearly separated and work in parallel.
