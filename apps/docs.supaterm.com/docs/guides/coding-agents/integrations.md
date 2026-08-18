---
title: Claude, Codex, and Pi
description: Understand supported agent behavior, setup differences, and session-fork boundaries.
---

All supported agents share Supaterm's sidebar and panel model. Their native integration boundaries differ.

## Claude

Claude hooks supply only root session identity and workspace data. Supaterm keeps the full managed hook set installed but ignores every event except `SessionStart`. The terminal sets `idle`, `working`, and `needs input`.

Claude sessions can be forked from the agent panel. The fork opens in a new pane and runs Claude's native fork-and-resume command in the agent workspace.

## Codex

Codex hooks supply only root session identity and workspace data. Supaterm keeps the full managed hook set installed but ignores every event except `SessionStart`. The terminal sets `idle`, `working`, and `needs input`.

Codex 0.144.1 or newer is required. Codex sessions can be forked from the agent panel with Codex's native fork command.

## Pi

Pi uses the extension package in `supaterm-skills`. The extension forwards Pi's native session and agent lifecycle while it runs inside a Supaterm pane.

Pi sessions cannot currently be forked from the agent panel. The copy-session-ID and fork actions only appear when the active agent supports them.

## Fork direction

Choose **Fork session right** from the agent panel to create a side-by-side pane. Hold Option to change the action to **Fork session below**. The new pane starts in the root agent's reported workspace directory when available.

The fork starts the account login shell and enters the agent's native fork command visibly. When the forked agent exits, the pane returns to that same shell.

Forking depends on the agent's native session data. It is different from terminal [session persistence](/guides/terminal-workflow/persistence), which keeps the existing process alive across an app restart.
