# Issue tracker: Linear

Issues and PRDs for this repo live in the Supaterm Linear workspace: https://linear.app/supaterm

Use the `linear` CLI for all operations. Team key is `SUP`; issue ids look like `SUP-123`.

## Ask before you file

Never create, close, or delete a Linear issue unless khoi asked for it or approved it in this
session. Draft the issue, show it, wait. Reading, listing, and searching need no approval.

## Conventions

- **Create an issue**: `linear issue create --team SUP -t "..." --description-file <path> --no-interactive`.
  Write the markdown body to a file first — `-d` mangles multi-line text. Add `-l <label>` (repeatable),
  `-p 1..4` for priority, `--parent SUP-123` for a child issue.
- **Read an issue**: `linear issue view SUP-123`. Comments are included; pass `--no-comments` to drop them,
  `-j` for JSON.
- **List issues**: `linear issue list --team SUP -A --limit 0`. The default filter is `unstarted` and
  your own issues only, so pass `-A` for all assignees and `--all-states` (or repeated `-s`) to widen it.
  States are `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`.
- **Comment**: `linear issue comment add SUP-123 --body-file <path>`.
- **Apply labels**: `linear issue update SUP-123 -l "ready-for-agent"`. Labels replace rather than
  accumulate — pass every label the issue should end up with.
- **Change state**: `linear issue update SUP-123 -s "Done"` (by name or type).
- **Close**: move it to a completed or canceled state; Linear has no separate close verb.
- **Create a label**: `linear label create -n <name> -c "#RRGGBB"`. Omit `--team` for a workspace label.

`linear api` takes a raw GraphQL query when the CLI has no verb for what you need.

## When a skill says "publish to the issue tracker"

Create a Linear issue on team `SUP` — after asking.

## When a skill says "fetch the relevant ticket"

Run `linear issue view <id>`. Inside a worktree, `linear issue id` reads the id off the current branch.

## Pull requests as a request surface

**PRs as a request surface: no.** _(Set to `yes` if GitHub PRs on supabitapp/supaterm should enter the
triage queue alongside Linear issues; `/triage` reads this flag.)_

## Wayfinding operations

Used by `/wayfinder`. The **map** is one issue with **child** issues as tickets.

- **Map**: an issue labelled `wayfinder:map` holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `linear issue create --parent <map-id>`, labelled `wayfinder:<type>`
  (`research` / `prototype` / `grilling` / `task`).
- **Blocking**: `linear issue relation add SUP-123 blocked-by SUP-100`. Read them back with
  `linear issue relation list SUP-123`. A ticket is unblocked when every blocker sits in a
  completed or canceled state.
- **Frontier query**: list the map's open children, drop any with an open blocker or an assignee;
  first in map order wins.
- **Claim**: `linear issue update <id> -a self`, or `linear issue start <id>` to claim and move it
  to a started state in one go.
- **Resolve**: comment the answer, move the issue to a completed state, then append a context
  pointer to the map's Decisions-so-far.
