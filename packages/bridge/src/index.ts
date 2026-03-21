#!/usr/bin/env bun

const args = process.argv.slice(2);
let serverUrl: string | undefined;
let token: string | undefined;
let targetPaneId: string | undefined;
let forceNew = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--token" && i + 1 < args.length) {
    token = args[++i];
  } else if (arg === "--pane" && i + 1 < args.length) {
    targetPaneId = args[++i];
  } else if (arg === "--new") {
    forceNew = true;
  } else if (arg && !arg.startsWith("-") && !serverUrl) {
    serverUrl = arg;
  }
}

if (!serverUrl) {
  process.stderr.write(
    [
      "supaterm-bridge: connect to a remote supaterm-cli terminal",
      "",
      "Usage: supaterm-bridge <server> [--token TOKEN] [--pane ID] [--new]",
      "",
      "  <server>       Server address (e.g. localhost:7681)",
      "  --token TOKEN  Auth token (printed by supaterm-cli on start)",
      "  --pane ID      Attach to a specific pane",
      "  --new          Always create a new tab+pane",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (!serverUrl.startsWith("ws://") && !serverUrl.startsWith("wss://")) {
  serverUrl = `ws://${serverUrl}`;
}
serverUrl = serverUrl.replace(/\/$/, "");

const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();

process.stderr.write(`Connecting to ${serverUrl}...\n`);

interface SyncState {
  selectedTabId: string | null;
  focusedPaneByTab: Record<string, string>;
  panes: Record<string, { id: string }>;
}

const controlUrl = `${serverUrl}/control${tokenParam}`;
const controlWs = new WebSocket(controlUrl);
let resolved = false;

controlWs.addEventListener("open", () => {});

controlWs.addEventListener("message", (event) => {
  if (resolved) return;
  try {
    const msg = JSON.parse(event.data as string);

    if (msg.type === "sync" && !resolved) {
      const state: SyncState = msg.state;

      if (targetPaneId) {
        if (!state.panes[targetPaneId]) {
          process.stderr.write(`Pane ${targetPaneId} not found\n`);
          process.exit(1);
        }
        resolved = true;
        attachToPane(targetPaneId);
        return;
      }

      if (!forceNew) {
        const focusedId = state.selectedTabId
          ? state.focusedPaneByTab[state.selectedTabId]
          : undefined;
        if (focusedId && state.panes[focusedId]) {
          resolved = true;
          attachToPane(focusedId);
          return;
        }
        const anyPaneId = Object.keys(state.panes)[0];
        if (anyPaneId) {
          resolved = true;
          attachToPane(anyPaneId);
          return;
        }
      }

      process.stderr.write("Creating new terminal...\n");
      controlWs.send(JSON.stringify({ type: "create_tab" }));
    }

    if (msg.type === "pane_created" && !resolved) {
      resolved = true;
      attachToPane(msg.paneId);
    }

    if (msg.type === "error") {
      process.stderr.write(`Server error: ${msg.message}\n`);
      process.exit(1);
    }
  } catch {}
});

controlWs.addEventListener("error", () => {
  process.stderr.write("Failed to connect to server\n");
  process.exit(1);
});

function attachToPane(paneId: string) {
  const ptyUrl = `${serverUrl}/pty/${paneId}${tokenParam}`;
  process.stderr.write(`Attaching to pane ${paneId.substring(0, 8)}...\n`);

  const ws = new WebSocket(ptyUrl);
  ws.binaryType = "arraybuffer";

  ws.addEventListener("open", () => {
    process.stderr.write("Connected.\n");

    process.stdin.on("data", (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new Uint8Array(chunk));
      }
    });

    process.on("SIGWINCH", () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const cols = process.stdout.columns;
      const rows = process.stdout.rows;
      if (cols && rows) {
        ws.send(
          JSON.stringify({ type: "resize", cols, rows }),
        );
      }
    });

    const cols = process.stdout.columns;
    const rows = process.stdout.rows;
    if (cols && rows) {
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  ws.addEventListener("message", (event) => {
    if (event.data instanceof ArrayBuffer) {
      process.stdout.write(Buffer.from(event.data));
    } else if (typeof event.data === "string") {
      process.stdout.write(event.data);
    }
  });

  ws.addEventListener("close", () => {
    process.stderr.write("Disconnected.\n");
    controlWs.close();
    process.exit(0);
  });

  ws.addEventListener("error", () => {
    process.stderr.write("Connection error.\n");
    controlWs.close();
    process.exit(1);
  });

  process.stdin.on("end", () => {
    ws.close();
    controlWs.close();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    ws.close();
    controlWs.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    ws.close();
    controlWs.close();
    process.exit(0);
  });
}
