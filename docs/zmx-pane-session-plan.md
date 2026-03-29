# Zmx Pane Session Plan

## Goal

Make each native/web pane map 1:1 to a durable `zmx` session.

Preserve Supaterm ownership of:

- workspaces
- tabs
- split trees
- focused pane selection
- UI metadata

Move ownership of terminal runtime to `zmx`:

- PTY lifetime
- shell/session persistence
- scrollback
- terminal state restore

## Current Reality

- Native app panes are real `GhosttySurfaceView` instances created through `TerminalHostState.createSurface(...)`.
- Native app only persists workspace catalog metadata today.
- Web server currently owns PTYs via `PtyManager` and persists layout/runtime-adjacent state in SQLite.
- There is no Share Extension, no App Group, and no share-target delivery protocol.

## Target Model

### Identity

- `Workspace` = grouping metadata
- `Tab` = grouping metadata + split tree
- `Pane` = durable terminal session
- `Pane` maps 1:1 to `zmxSessionName`

### Ownership

Supaterm owns:

- workspace names/order/default selection
- tab metadata and ordering
- split-tree topology
- focused pane per tab
- pane id to session mapping

`zmx` owns:

- the actual shell session
- scrollback
- terminal restore state
- detach/reattach behavior

## V1 Decisions

### Native attach strategy

Do not try to make Ghostty attach directly to an external PTY in v1.

Use the existing native seam:

- allocate a stable session name before `TerminalHostState.createSurface(...)`
- bootstrap the created surface with:
  - `initialInput = "exec zmx attach <session>\\n"`

This keeps Ghostty as the renderer/input client and makes `zmx` the durable runtime.

### Pane close semantics

Separate:

- close pane UI = detach
- kill pane session = explicit destructive action

Do not kill the backing `zmx` session automatically on pane close in v1.

### Web integration strategy

Keep browser-facing endpoints stable:

- `/control`
- `/pty/:paneId`

Replace the backend implementation behind `/pty/:paneId`:

- remove Bun PTY ownership
- resolve `paneId -> zmxSessionName`
- bridge websocket traffic to the target `zmx` session

### Share strategy

Do not start with XPC.

Use:

- macOS Share Extension
- App Group shared container
- staged share request files
- app activation/drain flow

Route v1 shares to the focused pane.

## Data Model Changes

Expand native persisted state from workspace-only to workspace/tab/pane topology metadata.

### Persisted workspace catalog

- `defaultSelectedWorkspaceID`
- `selectedTabIDByWorkspace`
- `workspaces`

### Persisted workspace

- `id`
- `name`
- `tabs`

### Persisted tab

- `id`
- `title`
- `icon`
- `isPinned`
- `isTitleLocked`
- `selectedPaneID`
- `splitTree`
- optional `zoomedPaneID`

### Persisted pane

- `id`
- `zmxSessionName`
- optional cached UI metadata:
  - `title`
  - `workingDirectory`
  - `lastKnownRunning`

### Persisted split tree

Persist a pure-id Codable tree:

- split node:
  - `direction`
  - `ratio`
  - `left`
  - `right`
- leaf node:
  - `paneID`

Do not persist `GhosttySurfaceView` or `SplitTree<GhosttySurfaceView>` directly.

## Shared Protocol Changes

Extend shared socket/tree payloads so external clients can target stable panes.

### Add to tree snapshot pane

- `id: UUID`
- optionally `sessionName: String`

### Add to pane creation response

- `paneID: UUID`
- optionally `sessionName: String`

### Add share/send method

New method, one of:

- `terminal.share`
- `terminal.send_input`

Payload should support:

- `targetPaneID`
- text payload
- URL/file payload
- `focusApp`

## Toolchain Plan

Keep `ThirdParty/zmx` close to upstream and patch locally.

### Patch `ThirdParty/zmx/build.zig.zon`

Replace remote Ghostty dependency with local vendored path:

- `../ghostty`

### Patch `ThirdParty/zmx/build.zig`

Stop reading the removed remote dependency hash for version info.

Use local Ghostty package metadata instead.

### Patch maintenance

Store a repo-local patch, for example:

- `ThirdParty/patches/zmx-use-local-ghostty.patch`

Apply it from bootstrap/build tooling.

## Execution Order

### Phase 0: Land vendor/toolchain support

1. Add `ThirdParty/zmx` submodule
2. Patch `zmx` to use vendored Ghostty
3. Add a repeatable build/apply-patch command
4. Verify `mise exec -- zig build check` succeeds in `ThirdParty/zmx`

### Phase 1: Define durable pane metadata

1. Add persisted tab/pane/split-tree model in native app
2. Make `TerminalTabID` Codable
3. Add pane id to session mapping
4. Migrate workspace-only JSON to the richer metadata format
5. Restore split trees from persisted ids on app launch

Deliverable:

- app can reconstruct tabs/panes/layout metadata without PTY runtime state

### Phase 2: Native pane -> zmx session

1. Allocate stable `zmxSessionName` for every pane
2. Thread pane session metadata into `TerminalHostState`
3. Change surface bootstrap so new panes run `exec zmx attach <session>`
4. Distinguish detach vs kill in pane lifecycle
5. Add explicit “kill pane session” command later if needed

Deliverable:

- native panes remain real panes
- each pane is backed by a durable `zmx` session

### Phase 3: Web PTY bridge replacement

1. Introduce `ZmxPaneSessionManager` or similar bridge abstraction
2. Replace `PtyManager`
3. Keep `/pty/:paneId` contract, but route through `paneId -> sessionName`
4. Remove Bun PTY creation and local scrollback buffering
5. Replace SQLite with JSON metadata persistence or make native app canonical

Deliverable:

- browser attaches bidirectionally to the same pane sessions as the native app

### Phase 4: Shared targeting protocol

1. Extend `SupatermTreeSnapshot.Pane` with stable ids
2. Extend pane creation responses with `paneID`
3. Add `terminal.share` or `terminal.send_input`
4. Add focused-pane and explicit-pane targeting

Deliverable:

- external clients can route actions to durable panes rather than indices

### Phase 5: Share Extension v1

1. Add macOS Share Extension target
2. Add App Group entitlements
3. Add App Group staging directory/helper
4. Write staged share request format
5. On app activation, drain share queue
6. Route v1 shares to focused pane

Deliverable:

- share into Supaterm lands in a live pane session

## Main Risks

### Native bootstrapping risk

Using `initialInput = "exec zmx attach ..."` is pragmatic but not perfect:

- shell startup timing matters
- attach UX may need tuning
- there may be edge cases around inherited cwd and shell init

### Web bridge correctness

The server-side `zmx` bridge must get right:

- initial attach/init
- restore timing
- resize forwarding
- detach cleanup

### Session lifecycle semantics

If close/detach/kill semantics are fuzzy, users will lose sessions unexpectedly.

### Persistence migration

Supaterm currently persists very little.
The new metadata model must be introduced carefully and sanitized on load.

## Fastest Viable Path

If the goal is to move quickly, do this first:

1. Patch and build vendored `zmx`
2. Add pane -> session metadata model
3. Make native panes bootstrap into `zmx attach`
4. Defer true share extension work until pane sessions are stable
5. Replace web PTY backend with a `zmx` bridge after native works

That gives the shortest path to validating the core architecture before spending time on the extension flow.
