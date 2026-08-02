# Domain Docs

How engineering skills should use this repo's domain docs when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the repo root.
- Relevant ADRs under `docs/adr/`.

If these files do not exist, proceed without raising their absence. Domain modeling skills create them when the team resolves terms or decisions.

## File structure

This repo uses one domain context:

```
/
├── CONTEXT.md
└── docs/adr/
    ├── 0001-example-decision.md
    └── 0002-example-decision.md
```

## Use the glossary's terms

When output names a domain concept, use the term defined in `CONTEXT.md`. Do not replace it with a synonym that the glossary rejects.

If the glossary lacks the concept, check whether the code already uses another term. If not, note the gap for domain modeling.

## Flag ADR conflicts

If output conflicts with an ADR, name the ADR and explain the conflict.
