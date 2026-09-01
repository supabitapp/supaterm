---
title: Claude, Codex, and Pi
description: Understand supported agent behavior, setup differences, and session-fork boundaries.
---

All supported agents share Supaterm's sidebar and panel model. Their integration boundaries differ.

## Claude

Claude hooks supply only root session identity and workspace data. Supaterm keeps the full managed hook set installed but ignores every event except `SessionStart`. The terminal sets `idle`, `working`, and `needs input`.

Claude sessions can be forked from the agent panel. The fork opens in a new pane and runs Claude's native fork-and-resume command in the agent workspace.

## Codex

Codex hooks supply only root session identity and workspace data. Supaterm keeps the full managed hook set installed but ignores every event except `SessionStart`. The terminal sets `idle`, `working`, and `needs input`.

Codex 0.144.1 or newer is required. Codex sessions can be forked from the agent panel with Codex's native fork command.

## Pi

Pi uses terminal detection only. Install Supaterm's skill with `sp skills install`; Pi reads the same `~/.agents/skills/supaterm` copy as other agents. Supaterm does not install a Pi package or change Pi settings.

Pi state is temporary and read-only. Pi sessions cannot be forked from the agent panel, copied by session ID, or restored as saved agent sessions.

## Fork direction

Choose **Fork session right** from the agent panel to create a side-by-side pane. Hold Option to change the action to **Fork session below**. The new pane starts in the root agent's reported workspace directory when available.

The fork starts the account login shell and enters the agent's native fork command visibly. When the forked agent exits, the pane returns to that same shell.

Forking depends on the agent's native session data. It is different from terminal [session persistence](/guides/terminal-workflow/persistence), which keeps the existing process alive across an app restart.
