---
title: Contributing to Supaterm
description: Build, test, and understand Supaterm's macOS app, websites, CLI, and integrations.
---

Supaterm is developed in the `supabitapp/supaterm` repository. Read the repository's `AGENTS.md` before making changes; local instructions are authoritative for terminology, validation, and workflow.

## Start developing

The [development guide](/contributing/development) covers repository bootstrap, Tuist generation, macOS checks and tests, isolated app state, website commands, and releases.

## Architecture guides

- [Chrome styling](/contributing/theming) explains the app's palette and snapshot boundaries.
- [Coding-agent integration](/contributing/coding-agents-integration) describes the shared lifecycle model, adapters, hooks, and transcript monitors.
- [Socket control](/contributing/how-socket-works) documents instance discovery, targeting, transport guarantees, and code ownership.

## User-facing integration content

Version-matched `sp` guides live in `integrations/supaterm-skills/skill-data`. Keep them synchronized whenever CLI behavior or coding-agent integration changes. The public docs should explain workflows; the bundled guides remain authoritative for exact commands in an installed version.
