---
name: product-requirement-alignment-review
description: Use when reviewing a Supaterm branch for product-requirement alignment before PR submission. Checks user-facing app, CLI, website, docs, release, and integration-skill surfaces for drift without editing them.
---

# Product-Requirement Alignment Review

Run this as a read-only review lane before PR submission.

## Sources

Read only the sources relevant to the changed files:

- `AGENTS.md`
- `apps/docs.supaterm.com/docs/contributing/development.md`
- `apps/docs.supaterm.com/docs/contributing/coding-agents-integration.md`
- `apps/docs.supaterm.com/docs/contributing/how-socket-works.md`
- `integrations/supaterm-skills/skills/supaterm`
- `apps/supaterm.com/src`
- `apps/supaterm.com/public/changelog`
- `apps/mac/supaterm`

## Workflow

1. Review the branch diff against user-facing behavior, docs, website copy, release surfaces, and integration-skill behavior.
2. Flag changed behavior, product scope, or user-facing workflow that no longer matches the relevant source.
3. Flag missing docs, changelog, website, or integration-skill updates when the diff materially changes public commands, settings, socket IPC, coding-agent behavior, release behavior, or visible app workflows.
4. Flag product-proof gaps when a UI-visible change lacks screenshot, snapshot, browser, app-run, or CLI evidence appropriate to the changed surface.
5. Do not edit files unless the parent explicitly asks.
6. Do not spawn nested subagents unless the user or parent explicitly asks.

Prioritize findings by PR-blocking product mismatch first, then missing user-facing docs or release-surface updates, then validation-risk issues. Include file:line evidence and the exact source path affected.
