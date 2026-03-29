# Session Catalog Conflict Resolution

## Goal

Allow the macOS app and the server/web flow to share `~/.config/supaterm/sessions.json` without a stale writer dropping newer pane or layout metadata.

The shared file is metadata only:

- workspaces
- tabs
- split trees
- focused pane selection
- `paneID -> zmx sessionName`

The terminal runtime still lives in `zmx`.

## State Ownership

The architecture follows the existing Point-Free style already used in Supaterm:

- each runtime has one in-memory state owner
- persistence is a boundary concern
- the boundary merges file state back into feature state
- UI/runtime state is rebuilt from the merged catalog instead of mutating ad hoc globals

In practice:

- native owns terminal UI state through `TerminalHostState`
- server owns web/socket state through `WorkspaceStateManager`
- both treat `sessions.json` as shared persisted state, not as their primary runtime model

## Merge Policy

Conflict resolution is timestamp-based and scoped by entity.

### Catalog selection

- `defaultSelectedWorkspaceID` uses `selectionUpdatedAt`
- newer `selectionUpdatedAt` wins

### Workspaces

- workspace fields use `workspace.updatedAt`
- newer `updatedAt` wins for:
  - `name`
  - `selectedTabID`
  - tab ordering source

### Tabs

- tab fields use `tab.updatedAt`
- newer `updatedAt` wins for:
  - `title`
  - `icon`
  - `isPinned`
  - `isTitleLocked`
  - `selectedPaneID`
  - `splitTree`
  - pane ordering source

### Panes

- pane fields use `pane.updatedAt`
- newer `updatedAt` wins for:
  - `sessionName`
  - `title`
  - `workingDirectoryPath`
  - `lastKnownRunning`

## Additive Merge Rule

Missing entities are preserved during merge.

That means:

- a workspace missing from one writer is kept if it still exists in the other
- a tab missing from one writer is kept if it still exists in the other
- a pane missing from one writer is kept if it still exists in the other

This is intentional. It prevents a stale native or server snapshot from deleting panes that were concurrently created elsewhere.

## Baseline Rule

The most important rule is that a writer does not compare its outgoing snapshot only against the current file on disk.

Instead, it compares against its last observed catalog baseline:

- native uses the current `@Shared(.terminalSessionCatalog)` value already loaded into `TerminalHostState`
- server `StateStore` tracks the last catalog it loaded or wrote

Why this matters:

- if the disk file changes externally and the local runtime has not yet incorporated it
- an unchanged local entity keeps its old timestamp
- the later merge against disk keeps the newer external entity

Without this rule, any stale save would look like a fresh edit and would overwrite newer external metadata.

## Delete Semantics

Deletes are explicit tombstones.

The catalog carries:

- `workspaceTombstones`
- `tabTombstones`
- `paneTombstones`

Each tombstone stores:

- entity id
- `deletedAt`

### Delete rule

- a tombstone removes an entity when `deletedAt >= updatedAt`
- newer deletes beat older entity snapshots
- newer recreated entities beat older tombstones

### Why this works

If native or server removes a pane while another runtime still has a stale copy:

- the stale runtime may still write the old pane data
- but the merged catalog also carries the newer pane tombstone
- prune-on-merge removes the stale pane from the written file

That prevents resurrection of deleted panes, tabs, and workspaces.

## Operational Expectations

The live behavior now is:

1. Native and server both observe `sessions.json`
2. External edits are reloaded into each runtime
3. Local saves are merged against the last observed baseline and the current on-disk file
4. Newer field edits win
5. Concurrent additions are preserved
6. Newer tombstones remove older entities
7. `zmx` sessions are not killed during catalog resync

## Tests

The merge contract is covered in:

- `supatermTests/PersistedTerminalSessionStateTests.swift`
- `supatermTests/TerminalHostStateZMXTests.swift`
- `packages/server/src/persistence.test.ts`
