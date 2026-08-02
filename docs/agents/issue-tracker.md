# Issue tracker: Linear

Issues and PRDs for this repo live in Linear under the `Supaterm` team. Use Linear MCP and follow `.agents/skills/linear/SKILL.md`.

## Workflow

- Confirm the issue identifier or the target team, project, priority, labels, cycle, and due date when needed.
- Read issues, relations, comments, and current team states before writing.
- Create and update issues with `save_issue`. Set the team to `Supaterm` when creating an issue.
- Read comments with `list_comments` and write comments with `save_comment`.
- Use the existing `Supaterm` states: `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Duplicate`, and `Canceled`.
- Explain the grouping before bulk writes.
- After each write, report what changed and any gaps.

## When a skill says "publish to the issue tracker"

Create a Linear issue under the `Supaterm` team.

## When a skill says "fetch the relevant ticket"

Read the Linear issue, its relations, and its comments.

## Wayfinding operations

- **Map**: one Linear issue that holds Notes, Decisions so far, and Fog.
- **Child ticket**: a sub-issue whose parent is the map.
- **Blocking**: use Linear's issue relations.
- **Frontier**: choose the first open child with no open blocker and no assignee.
- **Claim**: assign the child to `me` before work.
- **Resolve**: add the answer as a comment, move the child to `Done`, then add a context link to the map.
