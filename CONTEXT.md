# Supaterm Domain Context

Supaterm presents work owned by a headless host. Clients show and control that work. A client is never the execution owner.

## Terms

### Host

The one long-lived Supaterm process for a user and state root on a machine. It directly owns PTYs, child processes, agents, and host state. Client loss does not stop it.

### Client

An app, command, hook, or automation that connects to a host. A client can render state, send commands, or attach to a terminal. A client does not own a PTY.

### MachineID

The stable identity of a host installation. A socket path, network address, or tunnel is a route to a machine, not its identity.

### BootID

The identity of one host process lifetime. It changes each time the host starts. Clients discard state tied to an old `BootID`.

### TerminalID

The stable identity of one terminal and its PTY lifetime. A `TerminalID` is never rebound to a new PTY. A terminal can exist with no attachments.

### PaneID

The stable identity of one app-owned pane in a layout. A pane can refer to a terminal through `{ machineID, terminalID }`. A `PaneID` is not a process or PTY identity.

### AttachmentID

The identity of one live binding between a client view and a terminal. Attachments own transient input and size rights. Disconnecting an attachment does not end its terminal.

### Detach

Remove an attachment or pane placement while leaving the terminal and child process alive.

### End Terminal

Explicitly end a terminal, its PTY, and its child process. Closing a pane, tab, window, or client does not imply this action.

### Protocol Epoch

The exact host-client contract version. Both sides must use the same epoch. A mismatch fails before state or terminal traffic starts.

## Ownership

| Owner | State |
|---|---|
| Host | Machine identity, boot identity, terminals, PTYs, processes, terminal state, cwd, title, agents, hooks, transcripts, host process data, terminal lifecycle |
| App | Spaces, groups, tabs, panes, windows, focus, selection, zoom, scroll position, rendering, client notification delivery |
| Attachment | Input rights, size rights, client route, transient view binding |

Display titles, dirty state, and app summaries are derived from host and app state. Do not persist a second copy.

## Invariants

- A terminal survives app exit, client failure, transport loss, and the loss of every attachment while its host remains alive.
- Host crash, host restart, or machine restart may end every PTY and child process owned by that host.
- After a host restart, prior live terminals become interrupted records. Supaterm never claims to have recovered their OS processes.
- The host is the only PTY service. There is no per-terminal daemon, zmx path, PTY adoption, or file-descriptor handoff.
- The macOS Ghostty surface connects through a short-lived attach proxy. The proxy does not own the real PTY or child process.
- A terminal environment contains stable host and terminal context, not pane, tab, window, app process, or attachment identity.
- Host commands from `sp` run at the host. UI commands route through an active attachment and fail when no valid client route exists.
- App presentation state never enters host execution models.
- The protocol accepts one exact epoch. It has no hidden fallback or compatibility branch.

## Decisions

- [ADR 0001: Headless Host Owns Execution](docs/adr/0001-headless-host-owns-execution.md)
- [ADR 0002: Forward-Only Host Cutover](docs/adr/0002-forward-only-host-cutover.md)
