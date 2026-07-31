# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Single-context repo: one `CONTEXT.md` at the root, one `docs/adr/`.

## The domain docs are local, never committed

Both `CONTEXT.md` and `docs/adr/` are gitignored. They are khoi's working notes, not repo artifacts —
read them, write to them, never `git add` them. The committed glossary is the `## Terminology`
section of `AGENTS.md`; promote a term there only when khoi asks.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`## Terminology`** in `AGENTS.md`
- **`docs/adr/`** — read ADRs that touch the area you're about to work in

If any of these don't exist, **proceed silently**. Don't flag their absence; don't suggest creating
them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and
`/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test
name), use the term as defined in the glossary. Don't drift to synonyms it explicitly avoids.

If the concept you need isn't there yet, that's a signal — either you're inventing language the
project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (pane-owned surfaces) — but worth reopening because…_
