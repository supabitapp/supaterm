# ADR 0002: Forward-Only Host Cutover

- Status: Accepted
- Date: 2026-08-15

## Context

The host changes terminal ownership, app state, agent ownership, command routing, build output, and lifecycle tests. A broad rewrite could hide faults in PTY handling or terminal reconnect. A long-lived second path would keep two owners for the same concepts.

## Decision

Build the host through ordered technical gates. Each gate must pass its tests before work depends on it.

### Gate 1: Host and PTY core

The host must provide:

- an owner-only local socket;
- exact protocol-epoch handshake;
- stable `MachineID` and per-process `BootID`;
- terminal reserve, launch, list, get, attach, input, resize, detach, and end operations;
- direct PTY and child ownership;
- bounded output queues and explicit terminal exit.

Tests must use a real PTY. They must prove exact argument and cwd launch, binary input and output, resize, detach, continued child execution with no client, reattach, final output drain, and one child termination on `End Terminal`.

### Gate 2: Terminal state and reconnect

The host must parse PTY output into canonical terminal state. Attach must capture a snapshot at output sequence `N`, then deliver each byte after `N` once and in order.

Tests must cover parser continuation, alternate screen, Unicode, title, cwd, terminal query replies while detached, output during snapshot creation, replay overflow, slow readers, gap detection, and full resync.

### Gate 3: macOS attach proxy

The attach proxy must use raw mode, forward binary data, propagate size changes, preserve exact shell and direct-command launch rules, restore its outer terminal, and report exit without owning the child.

An end-to-end test must create work through the macOS app, terminate the app process, prove the real child and agent continue under the host, relaunch the app, attach to the same `TerminalID`, and verify correct screen and agent state.

### Gate 4: Presentation split

The app must use `PaneID` for layout and `TerminalID` for execution. Pane trees must contain data, not views. View objects bind through `AttachmentID` at runtime.

Tests must cover pane movement between tabs, Spaces, and windows without changing terminal identity. A command issued inside the terminal must route through the current attachment rather than stale launch-time tab or window state.

### Gate 5: Agent ownership

Move hook intake, transcript readers, process discovery, agent reduction, and host-derived agent state into the host. The app renders that state and delivers native notifications.

Tests must prove hooks and transcripts continue while no app runs, reconnect yields one canonical agent snapshot, and repeated hook delivery does not create duplicate state changes.

### Gate 6: Forward-only state cut

The app accepts only the new presentation format. Pane leaves contain `PaneID` and a terminal reference. Older session formats fail validation and have no decoder or migration path.

The host creates only its current store schema. It rejects an unknown version, a non-empty unversioned schema, or a changed schema definition. It never adopts old terminal metadata or binds a `TerminalID` to a new PTY.

Running zmx PTYs cannot transfer to the host. They must end before the cut. Supaterm never adopts their file descriptors or presents a restarted command as the same process.

At the cut:

- only the new layout and host stores are read;
- only the host creates real terminal PTYs;
- zmx code, settings, environment, build steps, tests, and docs are removed;
- no old decoder, migration entry point, or direct app PTY fallback remains;
- Supaterm never runs old and new terminal ownership at the same time.

### Gate 7: Host lifecycle and packaging

Ship and sign the host and attach modes with the app. Install the host as a per-user service. The app connects to it but does not own its lifetime.

Tests must cover install, first start, app crash, app relaunch, host crash, interrupted records after host restart, exact-epoch rejection, and upgrade refusal while live terminals exist.

### Gate 8: Remote transport

Only after the local path passes all prior gates, carry the same protocol over remote transport. Remote work uses the same terminal, agent, and command code as local work.

Tests must cover transport loss, reconnect, snapshot resync, slow readers, host restart, wrong epoch, and route changes that preserve `MachineID`.

## Cutover rule

There is one production terminal runtime at every point. Development-only proof code may exist before cutover, but it cannot become a user setting or fallback. The zmx production path is deleted in the same cutover that enables host-owned terminals.

## Consequences

The hardest terminal and lifecycle claims receive proof before app-wide state moves. The final product has one execution owner, one protocol, one state model, and no migration code.
