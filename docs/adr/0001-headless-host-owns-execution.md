# ADR 0001: Headless Host Owns Execution

- Status: Accepted
- Date: 2026-08-15

## Context

The macOS app currently mixes presentation, terminal execution, agent state, and local command routing. Its terminal surface starts an external PTY owner. App state also uses one surface identity for a view, layout leaf, terminal, and command target.

Supaterm must keep terminals and agents running when an app, browser, transport, or network connection ends. Recovery after the headless host itself dies is not required.

## Decision

Run one headless host per user and state root on each machine. The host directly owns every PTY, child process, terminal model, agent, and machine-dependent service.

The host lifecycle is independent from every client. On macOS, a user service owns that lifecycle. A GUI can install, start, and connect to the service but cannot make it its child.

The app owns all presentation:

- Spaces, groups, tabs, panes, and windows;
- focus, selection, zoom, scroll, and collapse state;
- rendering and native notification delivery.

The host does not store `PaneID`, tab identity, window identity, view identity, or platform UI objects. An app pane refers to a host terminal through `{ machineID, terminalID }`.

The identity model is:

```text
MachineID
  BootID
  TerminalID

PaneID -> { MachineID, TerminalID }
AttachmentID -> one live client-to-terminal binding
```

`TerminalID` names one PTY lifetime and is never reused for a replacement process. `BootID` lets clients reject data from an earlier host process. `AttachmentID` contains live input, size, and route state; it is not durable layout state.

Closing a pane, tab, window, or client detaches its attachments. Only `End Terminal` ends execution. A detached terminal remains discoverable until the user ends it or a future explicit retention rule removes its completed record.

Host death may end all PTYs and child processes. On the next boot, the host marks prior live records as interrupted. It may offer an explicit restart or agent resume, but that action creates a new terminal and never claims to recover the old process.

## Terminal connection

The macOS Ghostty surface has no caller-owned PTY input path. It starts a short-lived attach proxy as its command. The proxy forwards bytes, input, size changes, and exit state between Ghostty's outer PTY and the host protocol.

The attach proxy is a client. It never owns the real shell PTY, keeps no canonical terminal state, and cannot decide terminal lifetime.

The host maintains the canonical terminal state and an ordered output stream. Attach establishes one race-free snapshot boundary, then sends only output after that boundary. Slow or failed attachments cannot block PTY draining or other control work.

## Command routing

`sp` and agent hooks connect to the stable host endpoint. A terminal process receives `TerminalID` and host connection context. It does not receive durable pane, tab, window, app process, or attachment identity.

Host commands resolve from `TerminalID` and run in the host. Commands that change app presentation route through the terminal's active attachment. They fail with a clear no-client or ambiguous-client result when the host cannot select one valid route.

## Protocol

The host and each client must agree on one exact protocol epoch before any state or terminal traffic. An epoch mismatch returns an upgrade error. Supaterm does not keep old message decoders, alternate local protocols, or version-specific runtime branches.

Control, terminal, and bulk traffic have independent bounded queues. Terminal output uses a terminal-local byte sequence. Host state uses its own revision. Neither counter substitutes for the other.

## Rejected designs

- A GUI-owned PTY;
- zmx under or beside the host;
- one daemon per terminal;
- separate control and PTY services;
- PTY file-descriptor handoff or adoption;
- a local execution path distinct from remote host execution;
- app presentation identities in host models;
- terminal death caused by client detach;
- protocol fallback for old clients.

## Consequences

Client loss no longer defines process lifetime. The host becomes the only authority for execution and agent state. The app can present terminals from several machines in one layout without moving execution state into that layout.

Host upgrades cannot preserve live PTYs by transfer. Supaterm must wait for no live terminals or require an explicit action that ends them before replacing a running host with a new protocol epoch.
